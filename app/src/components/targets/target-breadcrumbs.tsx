"use client";

import { useEffect, useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatBreadcrumbTime } from "@/lib/targets/breadcrumb-format";
import { contextController, useTargetContext } from "@/lib/targets/context-controller";

interface Props {
  initialPrimaryLabel?: string;
  initialSecondaryLabel?: string | null;
  initialSecondaryTargetId?: string | null;
  interactive?: boolean;
}

export function TargetBreadcrumbs({ initialPrimaryLabel = "Self", initialSecondaryLabel = null,
  initialSecondaryTargetId = null, interactive = true }: Props) {
  const router = useRouter();
  const { snapshot, ready, stale, error } = useTargetContext();
  const [hovered, setHovered] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("research-target-changed", refresh);
    return () => window.removeEventListener("research-target-changed", refresh);
  }, [router]);

  const secondaryId = snapshot?.secondaryTargetId ?? (!ready ? initialSecondaryTargetId : null);
  const secondaryLabel = snapshot?.focusLabel ?? (!ready ? initialSecondaryLabel : null);
  const displayLabel = secondaryLabel ?? (secondaryId ? `Target ${secondaryId.slice(0, 8)}` : null);
  const prior = snapshot?.history[0];
  const act = async (action: () => Promise<unknown>) => {
    try { setActionError(null); await action(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Context update failed"); }
  };
  return (
    <nav aria-label="Research target breadcrumbs"
      className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {ready ? snapshot?.primaryLabel ?? "Self" : initialPrimaryLabel}
      </span>
      {interactive && snapshot?.canGoBack && <button type="button"
        onClick={() => void act(() => contextController.back())}
        aria-label="Back to prior target" title="Back to prior target"
        className="rounded p-0.5 hover:bg-muted"><ArrowLeft className="size-3" /></button>}
      {displayLabel && <>
        <span aria-hidden="true">&rsaquo;</span>
        <span className="relative flex items-center gap-1 font-medium text-foreground"
          onMouseEnter={() => interactive && setHovered(true)} onMouseLeave={() => setHovered(false)}>
          {displayLabel}
          <button type="button" onClick={() => void act(() => contextController.focus(null))}
            aria-label={`Clear secondary target ${displayLabel}`}
            className="rounded p-0.5 hover:bg-muted"><X className="size-3" /></button>
          {interactive && hovered && prior && <span role="tooltip"
            className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] rounded border border-border/60 bg-background p-2 text-[11px] shadow-md">
            <span className="block">Prior: {prior.targetLabel ?? prior.targetId.slice(0, 8)}</span>
            <span className="block">Set {formatBreadcrumbTime(prior.openedAt)}</span>
            {prior.lensId && <span className="block">Lens: {prior.lensLabel ?? "Unavailable"}</span>}
          </span>}
        </span>
      </>}
      {(stale || actionError || error || snapshot?.warning) && <span role="status" className="text-amber-700">
        {actionError ?? error ?? snapshot?.warning ?? "Context may be stale"}
      </span>}
      <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
        Press <kbd className="font-mono">T</kbd> to switch
      </span>
    </nav>
  );
}
