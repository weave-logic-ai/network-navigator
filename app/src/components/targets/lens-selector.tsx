"use client";

// Lens selector — switches the active lens for the current primary target
// and exposes a "Manage lenses" affordance that opens the Phase 4 Track H
// `LensManager` modal (save / share / delete).
//
// Renders the "Manage" entry even when the target has zero or one lens so
// the user can always save the current view as a new lens.

import { useCallback, useEffect, useState } from "react";
import { LensManager } from "./lens-manager";

interface LensDto {
  id: string;
  name: string;
  createdAt: string;
  config: Record<string, unknown>;
}

interface LensSelectorProps {
  primaryTargetId: string;
}

export function LensSelector({ primaryTargetId }: LensSelectorProps) {
  const [lenses, setLenses] = useState<LensDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/targets/${primaryTargetId}/lenses`);
      if (!res.ok) return;
      const json = (await res.json()) as { data: LensDto[]; activeLensId: string | null };
      setLenses(json.data ?? []);
      setActiveId(json.activeLensId);
    } catch {
      // Silent — selector is additive UI and tolerates fetch failures.
    }
  }, [primaryTargetId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

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
        const res = await fetch(
          `/api/targets/${primaryTargetId}/lenses/${nextId}/activate`,
          { method: "PUT" }
        );
        if (!res.ok) return;
        await load();
      } catch {
        // Silent — user can retry.
      } finally {
        setPending(false);
      }
    },
    [primaryTargetId, activeId, load]
  );

  const showSelect = lenses.length >= 2;

  // Compute the active lens's config so "save as new lens" inherits the
  // current view rather than saving an empty config.
  const activeConfig =
    lenses.find((l) => l.id === activeId)?.config ?? {};

  return (
    <>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="sr-only">Active lens</span>
        {showSelect ? (
          <>
            <span aria-hidden="true">Lens:</span>
            <select
              value={activeId ?? ""}
              onChange={handleChange}
              disabled={pending}
              className="rounded border border-border/40 bg-background px-1.5 py-0.5 text-xs"
              aria-label="Active lens for current target"
            >
              {lenses.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="__manage__">Manage lenses...</option>
            </select>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="rounded border border-border/40 bg-background px-2 py-0.5 text-xs"
            aria-label="Manage lenses for this target"
          >
            Manage lenses
          </button>
        )}
      </label>
      <LensManager
        primaryTargetId={primaryTargetId}
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onChanged={() => void load()}
        currentConfig={activeConfig as Record<string, unknown>}
      />
    </>
  );
}
