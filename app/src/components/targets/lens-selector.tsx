"use client";

// Lens selector — switches the active lens for the current primary target
// and exposes a "Manage lenses" affordance that opens the Phase 4 Track H
// `LensManager` modal (save / share / delete).
//
// Renders the "Manage" entry even when the target has zero or one lens so
// the user can always save the current view as a new lens.

import { useCallback, useEffect, useRef, useState } from "react";
import { LensManager } from "./lens-manager";
import { contextController, useTargetContext } from "@/lib/targets/context-controller";

interface LensDto {
  id: string;
  name: string;
  createdAt: string;
  config: Record<string, unknown>;
  icpProfileIds: string[];
}

interface LensListState {
  targetId: string;
  revision: string | undefined;
  status: "loading" | "ready" | "error";
  lenses: LensDto[];
}

interface LensSelectorProps {
  primaryTargetId: string;
}

export function LensSelector({ primaryTargetId }: LensSelectorProps) {
  const [list, setList] = useState<LensListState | null>(null);
  const { snapshot, ready } = useTargetContext();
  const hasSnapshot = Boolean(snapshot);
  const targetId = snapshot?.secondaryTargetId ?? primaryTargetId;
  const activeId = snapshot?.activeLensId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const loadSequence = useRef(0);
  const invalidateLoad = useCallback(() => { loadSequence.current++; }, []);

  const load = useCallback(async () => {
    if (ready && !hasSnapshot) return;
    const sequence = ++loadSequence.current;
    const revision = contextController.getSnapshot().snapshot?.revision;
    const isCurrent = () => sequence === loadSequence.current &&
      revision === contextController.getSnapshot().snapshot?.revision;
    setList({ targetId, revision, status: "loading", lenses: [] });
    try {
      const res = await fetch(`/api/targets/${targetId}/lenses`, { cache: "no-store" });
      if (!res.ok) throw new Error("Lens list unavailable");
      const json = (await res.json()) as { data: LensDto[]; activeLensId: string | null };
      if (!Array.isArray(json.data)) throw new Error("Invalid lens list");
      if (isCurrent()) setList({ targetId, revision, status: "ready", lenses: json.data });
    } catch {
      if (isCurrent()) setList({ targetId, revision, status: "error", lenses: [] });
    }
  }, [targetId, ready, hasSnapshot]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
      invalidateLoad();
    };
  }, [load, snapshot?.revision, invalidateLoad]);

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const nextId = e.target.value;
      if (nextId === "__manage__") {
        setManagerOpen(true);
        return;
      }
      if (!nextId || nextId === activeId) return;
      setPending(true);
      try {
        setError(null);
        await contextController.activateLens(targetId, nextId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Lens activation failed");
      } finally {
        setPending(false);
      }
    },
    [targetId, activeId]
  );

  const currentList = list?.targetId === targetId && list.revision === snapshot?.revision
    ? list : null;
  const lenses = currentList?.status === "ready" ? currentList.lenses : [];
  const listStatus = currentList?.status ?? "loading";

  // Compute the active lens's config so "save as new lens" inherits the
  // current view rather than saving an empty config.
  const activeConfig =
    lenses.find((l) => l.id === activeId)?.config ?? {};
  const activeIcpProfileIds =
    lenses.find((l) => l.id === activeId)?.icpProfileIds ?? [];

  if (ready && !hasSnapshot) return null;

  return (
    <>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      {listStatus === "error" && <span role="alert" className="flex items-center gap-1 text-xs text-destructive">
        Lens list unavailable.
        <button type="button" onClick={() => void load()} className="underline">Retry</button>
      </span>}
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="sr-only">Active lens</span>
        <>
          <span aria-hidden="true">Lens:</span>
          <select
              value={listStatus === "ready" ? activeId ?? "" : ""}
              onChange={handleChange}
              disabled={pending || listStatus !== "ready"}
              className="rounded border border-border/40 bg-background px-1.5 py-0.5 text-xs"
              aria-label="Active lens for current target"
            >
              {listStatus !== "ready" && <option value="">
                {listStatus === "error" ? "Lens list unavailable" : "Loading lenses..."}
              </option>}
              {listStatus === "ready" && activeId === null && <option value="">No active lens</option>}
              {lenses.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="__manage__">Manage lenses...</option>
          </select>
        </>
      </label>
      <LensManager
        primaryTargetId={targetId}
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onChanged={() => void load()}
        currentConfig={activeConfig as Record<string, unknown>}
        currentIcpProfileIds={activeIcpProfileIds}
      />
    </>
  );
}
