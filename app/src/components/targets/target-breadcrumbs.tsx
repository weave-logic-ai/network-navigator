"use client";

// Target breadcrumbs — global header trail showing:
//   Self  >  [Secondary]   [T]
//
// WS-4 Phase 1 Track B, extended by Phase 4 Track H:
//   - Hover state on the secondary crumb reveals the time the target was
//     set, the lens that was active, and a small back-arrow that swaps to
//     the prior secondary in history.
//   - History is persisted in `research_target_state.history` via
//     `/api/targets/state/history`.
//   - Gated on RESEARCH_FLAGS.targets at the mount site; when the flag is
//     off the parent surface passes `interactive={false}` so the crumb
//     renders as a static label without hover / back-stack affordances.
//
// Clicking the secondary crumb's "X" clears the secondary. The `T` shortcut
// hint opens the target picker (keyboard handled by TargetPickerModal).

import { useCallback, useEffect, useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { formatBreadcrumbTime } from "@/lib/targets/breadcrumb-format";

interface TargetStateDto {
  primaryTargetId: string | null;
  secondaryTargetId: string | null;
}

interface TargetDto {
  id: string;
  label: string;
  kind: "self" | "contact" | "company";
}

interface HistoryEntryDto {
  targetId: string;
  lensId: string | null;
  openedAt: string;
}

interface TargetBreadcrumbsProps {
  initialPrimaryLabel?: string;
  initialSecondaryLabel?: string | null;
  initialSecondaryTargetId?: string | null;
  /** When false, the hover card + swap-back are suppressed (flag-off mode). */
  interactive?: boolean;
}

export function TargetBreadcrumbs({
  initialPrimaryLabel = "Self",
  initialSecondaryLabel = null,
  initialSecondaryTargetId = null,
  interactive = true,
}: TargetBreadcrumbsProps) {
  const [primaryLabel] = useState(initialPrimaryLabel);
  const [secondaryLabel, setSecondaryLabel] = useState<string | null>(
    initialSecondaryLabel
  );
  const [secondaryId, setSecondaryId] = useState<string | null>(
    initialSecondaryTargetId
  );
  const [history, setHistory] = useState<HistoryEntryDto[]>([]);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const onTargetChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        secondaryTargetId: string | null;
        secondaryTargetLabel?: string | null;
      }>).detail;
      setSecondaryId(detail?.secondaryTargetId ?? null);
      setSecondaryLabel(detail?.secondaryTargetLabel ?? null);
      setHistory([]);
    };
    window.addEventListener("research-target-changed", onTargetChanged);
    return () => window.removeEventListener("research-target-changed", onTargetChanged);
  }, []);

  // Keep the component in sync if another tab / page updated the state.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/targets/state");
        if (!res.ok) return;
        const json = (await res.json()) as { data: TargetStateDto | null };
        if (cancelled || !json.data) return;
        if (!json.data.secondaryTargetId) {
          setSecondaryLabel(null);
          setSecondaryId(null);
          return;
        }
        if (json.data.secondaryTargetId === secondaryId && secondaryLabel) return;
        // Resolve the new secondary label.
        const targetRes = await fetch(
          `/api/targets?id=${json.data.secondaryTargetId}`
        );
        if (!targetRes.ok) return;
        const targetJson = (await targetRes.json()) as { data: TargetDto | null };
        if (cancelled || !targetJson.data) return;
        setSecondaryLabel(targetJson.data.label);
        setSecondaryId(targetJson.data.id);
      } catch {
        // Silent — breadcrumbs tolerate transient fetch failures.
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [secondaryId, secondaryLabel]);

  // Load history when the user hovers — lazy fetch to avoid a per-page-load
  // request when the hover card would never be shown.
  useEffect(() => {
    if (!interactive || !hovered) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/targets/state/history?limit=5");
        if (!res.ok) return;
        const json = (await res.json()) as { data: HistoryEntryDto[] };
        if (cancelled) return;
        setHistory(json.data ?? []);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hovered, interactive, secondaryId]);

  const handleClearSecondary = useCallback(async () => {
    try {
      const response = await fetch("/api/targets/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secondaryTargetId: null }),
      });
      if (!response.ok) return;
      setSecondaryLabel(null);
      setSecondaryId(null);
      window.dispatchEvent(new CustomEvent("research-target-changed", {
        detail: { secondaryTargetId: null },
      }));
    } catch {
      // Silent — state hasn't changed, user can retry.
    }
  }, []);

  const handleSwapToPrior = useCallback(async () => {
    // The current secondary is at history[0]; swap to history[1] if present.
    const prior = history[1];
    if (!prior) return;
    try {
      const response = await fetch("/api/targets/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secondaryTargetId: prior.targetId }),
      });
      if (!response.ok) return;
      window.dispatchEvent(new CustomEvent("research-target-changed", {
        detail: { secondaryTargetId: prior.targetId },
      }));
      // Best-effort resolve for optimistic UI update.
      try {
        const targetRes = await fetch(`/api/targets?id=${prior.targetId}`);
        if (targetRes.ok) {
          const targetJson = (await targetRes.json()) as { data: TargetDto | null };
          if (targetJson.data) {
            setSecondaryLabel(targetJson.data.label);
            setSecondaryId(targetJson.data.id);
          }
        }
      } catch {
        /* silent */
      }
    } catch {
      /* silent */
    }
  }, [history]);

  const current = history[0];
  const prior = history[1];

  return (
    <nav
      aria-label="Research target breadcrumbs"
      className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">{primaryLabel}</span>
      {secondaryLabel ? (
        <>
          <span aria-hidden="true">&rsaquo;</span>
          <span
            className="relative flex items-center gap-1 font-medium text-foreground"
            onMouseEnter={() => interactive && setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {interactive && prior ? (
              <button
                type="button"
                onClick={handleSwapToPrior}
                className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Swap back to prior secondary target"
                title="Back to prior target"
              >
                <ArrowLeft className="size-3" />
              </button>
            ) : null}
            {secondaryLabel}
            <button
              type="button"
              onClick={handleClearSecondary}
              className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label={`Clear secondary target ${secondaryLabel}`}
            >
              <X className="size-3" />
            </button>
            {interactive && hovered && current ? (
              <span
                role="tooltip"
                className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] rounded border border-border/60 bg-background p-2 text-[11px] shadow-md"
              >
                <span className="block font-medium text-foreground">
                  {secondaryLabel}
                </span>
                <span className="block text-muted-foreground">
                  Set {formatBreadcrumbTime(current.openedAt)}
                </span>
                {current.lensId ? (
                  <span className="block text-muted-foreground">
                    Lens: <code className="font-mono">{current.lensId.slice(0, 8)}</code>
                  </span>
                ) : (
                  <span className="block text-muted-foreground">
                    Lens: default
                  </span>
                )}
                {prior ? (
                  <span className="mt-1 block border-t border-border/40 pt-1 text-muted-foreground">
                    Prior: <code className="font-mono">{prior.targetId.slice(0, 8)}</code>
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </>
      ) : null}
      <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
        Press <kbd className="font-mono">T</kbd> to switch
      </span>
    </nav>
  );
}
