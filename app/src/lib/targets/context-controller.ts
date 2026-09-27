"use client";

import { useEffect, useSyncExternalStore } from "react";

export type ContextAction =
  | { type: "focus"; targetId: string | null }
  | { type: "back" }
  | { type: "activateLens"; targetId: string; lensId: string };

export interface ContextSnapshot {
  tenantId?: string;
  userId?: string | null;
  revision: string;
  primaryTargetId: string | null;
  secondaryTargetId: string | null;
  primaryLabel: string | null;
  focusLabel: string | null;
  activeLensId: string | null;
  activeLensLabel: string | null;
  canGoBack: boolean;
  warning: string | null;
  history: Array<{ targetId: string; targetLabel: string | null; lensId: string | null;
    lensLabel: string | null; lensUnavailable: boolean; openedAt: string }>;
}

export interface ContextView {
  snapshot: ContextSnapshot | null;
  ready: boolean;
  pending: number;
  stale: boolean;
  error: string | null;
}

type Intent = ContextAction | { type: "createFocus"; kind: "contact" | "company"; id: string };

export class ContextController {
  private view: ContextView = { snapshot: null, ready: false, pending: 0, stale: true, error: null };
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private refreshPromise: Promise<void> | null = null;
  private refreshGeneration = -1;
  private generation = 0;
  private channel: BroadcastChannel | null = null;
  private mounted = 0;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  getSnapshot = (): ContextView => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<ContextView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private accept(value: ContextSnapshot | null, fromWrite = false) {
    if (value && this.view.snapshot && (value.userId !== this.view.snapshot.userId ||
        value.tenantId !== this.view.snapshot.tenantId)) {
      this.reset();
    }
    if (value && (!/^(0|[1-9][0-9]*)$/.test(value.revision) ||
        (this.view.snapshot && BigInt(value.revision) < BigInt(this.view.snapshot.revision)))) return;
    if (!value && this.view.snapshot) return;
    const changed = value?.revision !== this.view.snapshot?.revision;
    this.publish({ snapshot: value, ready: true, stale: false, error: null });
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("research-target-changed", { detail: {
        secondaryTargetId: value?.secondaryTargetId ?? null,
        secondaryTargetLabel: value?.focusLabel ?? null,
        revision: value?.revision,
      } }));
      if (fromWrite) this.channel?.postMessage({ type: "invalidated", revision: value?.revision });
    }
  }
  async refresh(): Promise<void> {
    if (this.refreshPromise && this.refreshGeneration === this.generation) return this.refreshPromise;
    const generation = this.generation;
    const work = (async () => {
      try {
        const response = await this.fetcher("/api/targets/state", { cache: "no-store" });
        if (generation !== this.generation) return;
        if (response.status === 401 || response.status === 403) { this.reset(); return; }
        if (!response.ok) throw new Error("Context is unavailable");
        const body = await response.json() as { data?: ContextSnapshot | null };
        if (!("data" in body)) throw new Error("Invalid context response");
        if (generation === this.generation) {
          if (body.data === null) this.reset();
          else this.accept(body.data ?? null);
        }
      } catch {
        if (generation === this.generation) this.publish({ stale: true, error: "Context is offline or stale" });
      }
    })();
    const promise = work.finally(() => {
      if (this.refreshPromise === promise) this.refreshPromise = null;
    });
    this.refreshGeneration = generation;
    this.refreshPromise = promise;
    return this.refreshPromise;
  }
  reset() {
    const hadSnapshot = Boolean(this.view.snapshot);
    this.generation++;
    this.publish({ snapshot: null, ready: true, stale: true, error: null });
    if (hadSnapshot && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("research-target-changed", { detail: {
        secondaryTargetId: null, revision: null, reset: true,
      } }));
    }
  }
  dispatch(intent: Intent, requiredRevision?: string): Promise<ContextSnapshot> {
    const generation = this.generation;
    // A standalone Back is bound to the context visible at the click. A Back
    // queued behind local actions instead applies after those actions finish.
    const backRevision = intent.type === "back" && this.view.pending === 0
      ? this.view.snapshot?.revision : undefined;
    this.publish({ pending: this.view.pending + 1 });
    const operation = this.tail.then(() => this.execute(intent, generation, backRevision, requiredRevision));
    this.tail = operation.catch(() => undefined).finally(() => this.publish({ pending: this.view.pending - 1 }));
    return operation;
  }
  focus(targetId: string | null) { return this.dispatch({ type: "focus", targetId }); }
  back() { return this.dispatch({ type: "back" }); }
  activateLens(targetId: string, lensId: string, requiredRevision?: string) {
    return this.dispatch({ type: "activateLens", targetId, lensId }, requiredRevision);
  }
  createAndFocus(kind: "contact" | "company", id: string) {
    return this.dispatch({ type: "createFocus", kind, id });
  }
  private assertGeneration(generation: number) {
    if (generation !== this.generation) throw new Error("Context session changed; retry this action");
  }
  private async execute(intent: Intent, generation: number,
    backRevision?: string, requiredRevision?: string): Promise<ContextSnapshot> {
    this.assertGeneration(generation);
    if (!this.view.snapshot || this.view.stale) await this.refresh();
    this.assertGeneration(generation);
    if (!this.view.snapshot || this.view.stale) throw new Error("Context is unavailable");
    if (intent.type === "back" && backRevision !== undefined &&
        this.view.snapshot.revision !== backRevision) {
      const message = "Context changed; Back was not applied. Review the current context and try again.";
      this.publish({ error: message });
      throw new Error(message);
    }
    if (requiredRevision !== undefined && this.view.snapshot.revision !== requiredRevision) {
      const message = "Context changed; linked lens was not activated.";
      this.publish({ error: message });
      throw new Error(message);
    }
    let action: ContextAction;
    if (intent.type === "createFocus") {
      const response = await this.fetcher("/api/targets", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: intent.kind, id: intent.id }) });
      this.assertGeneration(generation);
      if (!response.ok) throw new Error("Could not create target");
      const body = await response.json() as { data?: { id?: string } };
      this.assertGeneration(generation);
      if (!body.data?.id) throw new Error("Invalid target response");
      action = { type: "focus", targetId: body.data.id };
    } else action = intent;
    this.assertGeneration(generation);
    const expectedRevision = this.view.snapshot?.revision;
    if (!expectedRevision) throw new Error("Context is unavailable");
    if (action.type === "activateLens" && action.targetId !==
        (this.view.snapshot?.secondaryTargetId ?? this.view.snapshot?.primaryTargetId)) {
      const message = "Target changed; lens was not activated. Review the current context.";
      this.publish({ error: message });
      throw new Error(message);
    }
    let response: Response;
    try {
      response = await this.fetcher("/api/targets/state", { method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, action }) });
    } catch {
      this.assertGeneration(generation);
      this.publish({ stale: true, error: "Context write failed" });
      throw new Error("Context write failed");
    }
    this.assertGeneration(generation);
    const body = await response.json().catch(() => ({})) as { data?: ContextSnapshot; error?: string };
    this.assertGeneration(generation);
    if (response.ok && body.data) {
      if (this.view.snapshot && (body.data.userId !== this.view.snapshot.userId ||
          body.data.tenantId !== this.view.snapshot.tenantId)) {
        this.reset();
        throw new Error("Context session changed; retry this action");
      }
      this.accept(body.data, true);
      this.assertGeneration(generation);
      return body.data;
    }
    if (response.status === 409) {
      if (body.data) this.accept(body.data);
      else await this.refresh();
      this.assertGeneration(generation);
      const message = action.type === "back"
        ? "Context changed; Back was not applied. Review the current context and try again."
        : "Context changed; action was not applied. Review the current context and try again.";
      this.publish({ error: message });
      throw new Error(message);
    }
    if (response.status === 428) {
      this.publish({ error: "Context protocol error: expectedRevision was rejected" });
      throw new Error("Context protocol error: expectedRevision was rejected");
    }
    if (response.status === 401 || response.status === 403) this.reset();
    this.publish({ stale: response.status >= 500 || this.view.stale,
      error: body.error ?? "Context write failed" });
    throw new Error(body.error ?? "Context write failed");
  }
  mount() {
    this.mounted++;
    if (this.mounted > 1 || typeof window === "undefined") return () => this.unmount();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("research-target-context");
      this.channel.onmessage = () => { this.invalidate(false); };
    }
    window.addEventListener("focus", this.onVisible);
    document.addEventListener("visibilitychange", this.onVisible);
    this.poll = setInterval(() => { if (document.visibilityState === "visible") void this.refresh(); }, 30000);
    void this.refresh();
    return () => this.unmount();
  }
  private onVisible = () => { if (document.visibilityState === "visible") void this.refresh(); };
  private unmount() {
    if (--this.mounted > 0) return;
    this.channel?.close(); this.channel = null;
    window.removeEventListener("focus", this.onVisible);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }
  invalidate(broadcast = true) {
    const inFlight = this.refreshPromise;
    if (inFlight) void inFlight.finally(() => this.refresh());
    else void this.refresh();
    if (broadcast) this.channel?.postMessage({ type: "invalidated" });
  }
}

export const contextController = new ContextController();

export function useTargetContext() {
  useEffect(() => contextController.mount(), []);
  return useSyncExternalStore(contextController.subscribe, contextController.getSnapshot,
    contextController.getSnapshot);
}
