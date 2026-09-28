"use client";

// Lens manager — Phase 4 Track H modal for listing / sharing / deleting the
// lenses attached to the current primary target.
//
// Opened from `lens-selector.tsx`'s "Manage lenses" dropdown item. Each row
// shows: name, active-state, created-at, share button, delete button.
// "Save current view as new lens" fires a POST to /api/targets/:id/lenses.
//
// Share buttons produce two URL shapes via `lens-url.ts`:
//   - `?lens=<lensId>`                — tenant-local, reads the stored config
//   - `?lens=opaque:<base64-config>`  — self-contained, works cross-tenant
//
// Both are copied to clipboard via the async Clipboard API; we silently swallow
// failures (test envs without clipboard just no-op).

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Copy, Trash2, Check } from "lucide-react";
import { buildLensShareUrls } from "@/lib/targets/lens-url";
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
const EMPTY_LENSES: LensDto[] = [];

interface LensManagerProps {
  primaryTargetId: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  /** Current config the user would save as a new lens (ICPs, filters, etc.). */
  currentConfig?: Record<string, unknown>;
  currentIcpProfileIds?: string[];
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function LensManager({
  primaryTargetId,
  open,
  onClose,
  onChanged,
  currentConfig,
  currentIcpProfileIds,
}: LensManagerProps) {
  const [list, setList] = useState<LensListState | null>(null);
  const { snapshot } = useTargetContext();
  const activeId = snapshot?.activeLensId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const invalidateLoad = useCallback(() => { loadSequence.current++; }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const revision = contextController.getSnapshot().snapshot?.revision;
    const isCurrent = () => sequence === loadSequence.current &&
      revision === contextController.getSnapshot().snapshot?.revision;
    setList({ targetId: primaryTargetId, revision, status: "loading", lenses: [] });
    try {
      const res = await fetch(`/api/targets/${primaryTargetId}/lenses`, { cache: "no-store" });
      if (!res.ok) throw new Error("Lens list unavailable");
      const json = (await res.json()) as { data: LensDto[]; activeLensId: string | null };
      if (!Array.isArray(json.data)) throw new Error("Invalid lens list");
      if (isCurrent()) setList({ targetId: primaryTargetId, revision, status: "ready", lenses: json.data });
    } catch {
      if (isCurrent()) setList({ targetId: primaryTargetId, revision, status: "error", lenses: [] });
    }
  }, [primaryTargetId]);

  const currentList = list?.targetId === primaryTargetId && list.revision === snapshot?.revision
    ? list : null;
  const listStatus = currentList?.status ?? "loading";
  const lenses = listStatus === "ready" ? currentList!.lenses : EMPTY_LENSES;
  const canAct = useCallback(() => {
    const current = contextController.getSnapshot().snapshot;
    return listStatus === "ready" && current?.revision === snapshot?.revision &&
      (current?.secondaryTargetId ?? current?.primaryTargetId) === primaryTargetId;
  }, [listStatus, snapshot?.revision, primaryTargetId]);

  useEffect(() => {
    if (open) void load();
    return invalidateLoad;
  }, [open, load, snapshot?.revision, invalidateLoad]);

  const handleActivate = useCallback(
    async (lensId: string) => {
      if (!canAct() || !lenses.some(lens => lens.id === lensId)) return;
      try {
        setError(null);
        await contextController.activateLens(primaryTargetId, lensId);
        await load();
        onChanged?.();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Lens activation failed");
      }
    },
    [primaryTargetId, load, onChanged, lenses, canAct]
  );

  const handleDelete = useCallback(
    async (lensId: string) => {
      if (!canAct() || !lenses.some(lens => lens.id === lensId)) return;
      try {
        const response = await fetch(`/api/targets/${primaryTargetId}/lenses/${lensId}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Lens deletion failed");
        contextController.invalidate();
        await load();
        onChanged?.();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Lens deletion failed");
      }
    },
    [primaryTargetId, load, onChanged, lenses, canAct]
  );

  const handleShareTenantLocal = useCallback(
    async (lens: LensDto) => {
      if (!canAct() || !lenses.some(item => item.id === lens.id)) return;
      const { tenantLocal } = buildLensShareUrls({
        origin:
          typeof window !== "undefined" ? window.location.origin : "",
        pathname:
          typeof window !== "undefined" ? window.location.pathname : "/",
        lensId: lens.id,
        config: { ...lens.config, icpProfileIds: lens.icpProfileIds },
        lensName: lens.name,
      });
      const ok = await copyToClipboard(tenantLocal);
      if (ok) {
        setCopiedId(`tenant:${lens.id}`);
        setTimeout(() => setCopiedId(null), 1600);
      }
    },
    [lenses, canAct]
  );

  const handleShareOpaque = useCallback(async (lens: LensDto) => {
    if (!canAct() || !lenses.some(item => item.id === lens.id)) return;
    const { opaque } = buildLensShareUrls({
      origin:
        typeof window !== "undefined" ? window.location.origin : "",
      pathname:
        typeof window !== "undefined" ? window.location.pathname : "/",
      lensId: lens.id,
      config: { ...lens.config, icpProfileIds: lens.icpProfileIds },
      lensName: lens.name,
    });
    const ok = await copyToClipboard(opaque);
    if (ok) {
      setCopiedId(`opaque:${lens.id}`);
      setTimeout(() => setCopiedId(null), 1600);
    }
  }, [lenses, canAct]);

  const handleSave = useCallback(async () => {
    const name = savingName.trim();
    if (!name || !canAct()) return;
    try {
      const response = await fetch(`/api/targets/${primaryTargetId}/lenses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          config: currentConfig ?? {},
          icpProfileIds: currentIcpProfileIds ?? [],
        }),
      });
      if (!response.ok) throw new Error("Lens save failed");
      setSavingName("");
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lens save failed");
    }
  }, [primaryTargetId, savingName, currentConfig, currentIcpProfileIds, load, onChanged, canAct]);

  const handleDuplicate = useCallback(async (lens: LensDto) => {
    if (!canAct() || !lenses.some(item => item.id === lens.id)) return;
    try {
      setError(null);
      const response = await fetch(`/api/targets/${primaryTargetId}/lenses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `${lens.name} copy`, config: lens.config,
          icpProfileIds: lens.icpProfileIds }),
      });
      if (!response.ok) throw new Error("Lens duplication failed");
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lens duplication failed");
    }
  }, [primaryTargetId, lenses, load, onChanged, canAct]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="Manage lenses"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-medium">Manage lenses</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close manage lenses"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && <div role="alert" className="px-4 py-2 text-xs text-destructive">{error}</div>}
        {listStatus === "error" && <div role="alert" className="flex gap-2 px-4 py-2 text-xs text-destructive">
          Lens list unavailable.
          <button type="button" onClick={() => void load()} className="underline">Retry</button>
        </div>}
        <div className="max-h-96 overflow-auto">
          {listStatus === "loading" && (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading...</div>
          )}
          {listStatus === "ready" && lenses.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No lenses yet. Save the current view below.
            </div>
          )}
          {lenses.map((lens) => (
            <div
              key={lens.id}
              className="flex items-center gap-2 border-b border-border/40 px-4 py-3 text-sm last:border-b-0"
            >
              <button
                type="button"
                onClick={() => handleActivate(lens.id)}
                className="flex-1 text-left"
                aria-label={`Activate lens ${lens.name}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{lens.name}</span>
                  {lens.id === activeId ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                      Active
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Created {formatRelativeTime(lens.createdAt)}
                </div>
              </button>

              <button
                type="button"
                onClick={() => void handleDuplicate(lens)}
                className="rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted"
                aria-label={`Duplicate lens ${lens.name}`}
              >
                Duplicate
              </button>

              <button
                type="button"
                onClick={() => handleShareTenantLocal(lens)}
                className="rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted"
                aria-label={`Copy tenant link for ${lens.name}`}
                title="Copy link for this tenant"
              >
                {copiedId === `tenant:${lens.id}` ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span className="ml-1">Link</span>
              </button>

              <button
                type="button"
                onClick={() => handleShareOpaque(lens)}
                className="rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted"
                aria-label={`Copy opaque lens config for ${lens.name}`}
                title="Copy opaque lens config (cross-tenant)"
              >
                {copiedId === `opaque:${lens.id}` ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span className="ml-1">Opaque</span>
              </button>

              <button
                type="button"
                onClick={() => handleDelete(lens.id)}
                className="rounded border border-transparent p-1 text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
                aria-label={`Delete lens ${lens.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
          <input
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            placeholder="Name for this lens..."
            className="flex-1 rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none"
            aria-label="New lens name"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!savingName.trim() || listStatus !== "ready"}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition disabled:opacity-50"
          >
            Save as new lens
          </button>
        </div>
      </div>
    </div>
  );
}
