// Per-field source conflict banner (ADR-032).
//
// Rendered on contact / company detail pages beside each field that has
// disagreeing sources. Behavior:
//   - Yellow warning chrome, single-line summary + [Change] action.
//   - When `pinnedByUser === true`, the message reads "Overridden by you"
//     and cites which sources disagree with the override.
//   - When `pinnedByUser === false`, the message cites the winning source
//     and the top dissenting source, following ADR-032's "highlight, don't
//     hide" directive.
//   - Clicking [Change] opens a modal with every candidate value grouped
//     by source, plus a "Pin this value" action per candidate and a
//     "Clear override" action when applicable.
//
// The banner is a client component; it fetches once and caches on mount.
// Parent pages pass the `targetId` (research_targets.id) and a list of
// field names to surface.
//
// Dismissal persistence (ADR-032 gap-2 fix): dismissing a banner POSTs to
// `/api/targets/[id]/banner-state` with a fingerprint of the current
// candidate-value set (see `fingerprintOf` below — must stay in sync with
// `conflictFingerprint()` in `lib/targets/banner-state-service.ts`, which
// this client component cannot import directly since that module pulls in
// the `pg` pool). A dismissal only suppresses the banner while the stored
// fingerprint still matches the live conflict; once a new source changes
// the candidate set, the banner reappears even though the dismissal row is
// still there — this is what makes the ADR's fatigue mitigation ("banners
// re-appear on a new source arrival, not on every page load") deliberate
// rather than an accident of a per-page-load in-memory `useState`.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface DisagreementSource {
  sourceRecordId: string;
  sourceType: string;
  canonicalUrl: string | null;
  title: string | null;
  finalWeight: number;
  referencedDate: string | null;
}

interface DisagreementCandidate {
  value: string;
  weightSum: number;
  sources: DisagreementSource[];
}

interface DisagreementResult {
  entityKind: "contact" | "company";
  entityId: string;
  fieldName: string;
  hasConflict: boolean;
  pinnedByUser: boolean;
  winner: DisagreementCandidate | null;
  candidates: DisagreementCandidate[];
}

interface ConflictsResponse {
  entityKind: "contact" | "company";
  entityId: string;
  conflicts: Record<string, DisagreementResult>;
}

export interface SourceConflictBannerProps {
  targetId: string;
  /** Fields to inspect. Default: `title,company,location,headline`. */
  fields?: string[];
  /** Display-friendly name for the subject, e.g. "Jane". Used in banner copy. */
  subjectLabel?: string;
}

const DEFAULT_FIELDS = ["title", "company", "location", "headline"];

/**
 * Order-independent fingerprint of a conflict's candidate values. Must stay
 * in sync with `conflictFingerprint()` in
 * `lib/targets/banner-state-service.ts` — duplicated here (rather than
 * imported) because that module pulls in the `pg` connection pool via
 * `lib/db/client`, which cannot be bundled into a client component.
 */
function fingerprintOf(candidates: DisagreementCandidate[]): string {
  return candidates
    .map((c) => c.value)
    .sort()
    .join(" ");
}

function summarizeConflict(
  fieldName: string,
  result: DisagreementResult,
  subjectLabel?: string
): string {
  if (result.pinnedByUser) {
    return `Overridden by you — new sources disagree on ${subjectLabel ? `${subjectLabel}'s ` : ""}${fieldName}. Review sources.`;
  }
  if (!result.winner || result.candidates.length < 2) return "";
  const winnerSources = result.winner.sources
    .map((s) => s.sourceType)
    .slice(0, 2)
    .join(", ");
  const loser = result.candidates[1];
  const loserSources = loser.sources
    .map((s) => s.sourceType)
    .slice(0, 2)
    .join(", ");
  return `Sources disagree on ${subjectLabel ? `${subjectLabel}'s ` : ""}${fieldName} — ${winnerSources} says "${result.winner.value}", ${loserSources} says "${loser.value}". Used ${winnerSources}.`;
}

export function SourceConflictBanner({
  targetId,
  fields = DEFAULT_FIELDS,
  subjectLabel,
}: SourceConflictBannerProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [conflicts, setConflicts] = useState<ConflictsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // fieldName -> fingerprint the user last dismissed. Loaded from
  // `/banner-state` on mount so dismissal survives a refresh; a field is
  // only treated as dismissed while its live fingerprint still matches.
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<DisagreementResult | null>(null);

  const fieldKey = useMemo(() => fields.join(","), [fields]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [conflictsRes, dismissalsRes] = await Promise.all([
        fetch(
          `/api/targets/${encodeURIComponent(targetId)}/field-conflicts?fields=${encodeURIComponent(fieldKey)}`,
          { cache: "no-store" }
        ),
        fetch(`/api/targets/${encodeURIComponent(targetId)}/banner-state`, {
          cache: "no-store",
        }),
      ]);
      if (conflictsRes.status === 404) {
        setConflicts(null);
        return;
      }
      if (!conflictsRes.ok) throw new Error(`HTTP ${conflictsRes.status}`);
      setConflicts((await conflictsRes.json()) as ConflictsResponse);

      if (dismissalsRes.ok) {
        const body = (await dismissalsRes.json()) as {
          dismissals: { fieldName: string; conflictFingerprint: string }[];
        };
        const next: Record<string, string> = {};
        for (const d of body.dismissals) next[d.fieldName] = d.conflictFingerprint;
        setDismissed(next);
      }
      // A non-ok banner-state fetch (e.g. flag off, transient error) just
      // means no persisted dismissals are known this load — banners show,
      // which is the safe default (never silently hide a conflict).
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [targetId, fieldKey]);

  useEffect(() => {
    load();
  }, [load]);

  const conflictingFields = useMemo(() => {
    if (!conflicts) return [] as DisagreementResult[];
    return Object.values(conflicts.conflicts).filter(
      (r) =>
        r.hasConflict &&
        dismissed[r.fieldName] !== fingerprintOf(r.candidates)
    );
  }, [conflicts, dismissed]);

  const dismissField = useCallback(
    (c: DisagreementResult) => {
      const fingerprint = fingerprintOf(c.candidates);
      // Optimistic local update so the banner disappears immediately.
      setDismissed((prev) => ({ ...prev, [c.fieldName]: fingerprint }));
      fetch(`/api/targets/${encodeURIComponent(targetId)}/banner-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldName: c.fieldName, fingerprint }),
      }).catch(() => {
        // Best-effort: if persistence fails, the banner still hides for
        // this session (the optimistic update above already applied) but
        // will reappear on next reload. That degrades to the pre-fix
        // behavior rather than losing the user's dismiss action outright.
      });
    },
    [targetId]
  );

  if (loading) return null;
  if (error) return null;
  if (conflictingFields.length === 0) return null;

  return (
    <div className="space-y-2">
      {conflictingFields.map((c) => (
        <div
          key={c.fieldName}
          className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
          role="alert"
          data-testid={`source-conflict-${c.fieldName}`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-700" />
          <div className="flex-1">
            <p>{summarizeConflict(c.fieldName, c, subjectLabel)}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModal(c)}
            className="h-7 px-2 text-xs"
          >
            Change
          </Button>
          <button
            aria-label="Dismiss"
            onClick={() => dismissField(c)}
            className="text-yellow-700 hover:text-yellow-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <ConflictModal
        targetId={targetId}
        conflict={modal}
        onClose={() => setModal(null)}
        onChanged={() => {
          setModal(null);
          load();
        }}
      />
    </div>
  );
}

interface ConflictModalProps {
  targetId: string;
  conflict: DisagreementResult | null;
  onClose: () => void;
  onChanged: () => void;
}

function ConflictModal({
  targetId,
  conflict,
  onClose,
  onChanged,
}: ConflictModalProps) {
  const [saving, setSaving] = useState<boolean>(false);
  const [manualValue, setManualValue] = useState<string>("");

  async function pinValue(value: string) {
    if (!conflict) return;
    setSaving(true);
    try {
      await fetch(`/api/targets/${encodeURIComponent(targetId)}/field-overrides`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldName: conflict.fieldName, value }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    if (!conflict) return;
    setSaving(true);
    try {
      await fetch(
        `/api/targets/${encodeURIComponent(targetId)}/field-overrides?field=${encodeURIComponent(conflict.fieldName)}`,
        { method: "DELETE" }
      );
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!conflict} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {conflict ? `Review sources — ${conflict.fieldName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {conflict && (
          <div className="space-y-3 text-sm">
            {conflict.pinnedByUser && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                You have pinned this field to &quot;{conflict.winner?.value}
                &quot;. New sources below may disagree; click &quot;Clear
                override&quot; to let sources reconcile automatically.
              </div>
            )}
            <ul className="space-y-2">
              {conflict.candidates.map((cand) => (
                <li
                  key={cand.value}
                  className="flex items-start justify-between gap-2 rounded border p-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="truncate">{cand.value || "(empty)"}</strong>
                      <Badge variant="secondary" className="text-xs">
                        w={cand.weightSum.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {cand.sources.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Pinned by user (no source attribution)
                        </span>
                      ) : (
                        cand.sources.map((s) => (
                          <Badge
                            key={s.sourceRecordId}
                            variant="outline"
                            className="text-xs"
                          >
                            {s.sourceType}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => pinValue(cand.value)}
                  >
                    Pin this
                  </Button>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Or enter a custom value
              </label>
              <div className="flex gap-2">
                <Input
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder={`New ${conflict.fieldName}`}
                />
                <Button
                  size="sm"
                  disabled={saving || manualValue.trim().length === 0}
                  onClick={() => pinValue(manualValue.trim())}
                >
                  Pin
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="flex gap-2">
          {conflict?.pinnedByUser && (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={clearOverride}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Clear override"
              )}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
