"use client";

import { useCallback, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Loader2, Shield, Trash2, RefreshCw, Check, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface PurgeResult {
  deleted: number;
  scope: string;
}

interface ReindexPhase {
  phase: string;
  status: string;
  current?: number;
  total?: number;
  detail?: string;
  generated?: number;
  skipped?: number;
  errors?: number;
}

const PHASE_LABELS: Record<string, string> = {
  embeddings: "Profile Embeddings",
  "niche-counts": "Niche Member Counts",
  "icp-scores": "ICP Fit Scores",
  done: "Complete",
  error: "Error",
};

export function DataTab() {
  const [purgeDialog, setPurgeDialog] = useState<{
    open: boolean;
    scope: string;
    label: string;
  }>({ open: false, scope: "", label: "" });
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [erasureId, setErasureId] = useState("");
  const [erasureConfirm, setErasureConfirm] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [erasureResult, setErasureResult] = useState<string | null>(null);

  // Reindex
  const [reindexOpen, setReindexOpen] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexPhases, setReindexPhases] = useState<ReindexPhase[]>([]);
  const [reindexForce, setReindexForce] = useState(false);

  const handleReindex = useCallback(async (regenerate: boolean) => {
    setReindexing(true);
    setReindexPhases([]);
    setReindexOpen(true);

    try {
      const res = await fetch("/api/admin/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as ReindexPhase;
            setReindexPhases((prev) => {
              const existing = prev.findIndex(
                (p) => p.phase === data.phase && data.status !== "complete"
              );
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = data;
                return next;
              }
              return [...prev, data];
            });
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch {
      setReindexPhases((prev) => [
        ...prev,
        { phase: "error", status: "error", detail: "Connection failed" },
      ]);
    } finally {
      setReindexing(false);
    }
  }, []);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    setPurgeResult(null);
    try {
      const res = await fetch("/api/admin/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: purgeDialog.scope,
          confirmToken: "CONFIRM_PURGE",
        }),
      });
      if (!res.ok) throw new Error("Purge failed");
      const json = await res.json();
      setPurgeResult(json.data ?? { deleted: 0, scope: purgeDialog.scope });
    } catch {
      setPurgeResult({ deleted: -1, scope: purgeDialog.scope });
    } finally {
      setPurging(false);
      setPurgeDialog({ open: false, scope: "", label: "" });
    }
  }, [purgeDialog.scope]);

  const handleErasure = useCallback(async () => {
    setErasing(true);
    setErasureResult(null);
    try {
      const res = await fetch("/api/admin/erasure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: erasureId.trim(),
          confirmToken: "CONFIRM_ERASURE",
        }),
      });
      if (!res.ok) throw new Error("Erasure failed");
      setErasureResult(`All data erased for contact ${erasureId.trim()}.`);
      setErasureId("");
      setErasureConfirm(false);
    } catch {
      setErasureResult("Erasure failed. Check the contact ID and try again.");
    } finally {
      setErasing(false);
    }
  }, [erasureId]);

  return (
    <>
      <div className="space-y-4">
        {/* Reindex */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <CardTitle className="text-base">Reindex Data</CardTitle>
            </div>
            <CardDescription>
              Regenerate embeddings, update niche member counts, and recompute ICP fit scores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={reindexing}
                onClick={() => handleReindex(false)}
              >
                {reindexing && !reindexForce ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Reindex (Incremental)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={reindexing}
                onClick={() => {
                  setReindexForce(true);
                  handleReindex(true);
                }}
              >
                {reindexing && reindexForce ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Full Rebuild
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Export */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              <CardTitle className="text-base">Export Contacts</CardTitle>
            </div>
            <CardDescription>Download all contacts as a CSV file.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/admin/export";
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </CardContent>
        </Card>

        {/* Purge */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <CardTitle className="text-base">Purge Data</CardTitle>
            </div>
            <CardDescription>
              Permanently delete scoring or enrichment data. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setPurgeDialog({ open: true, scope: "scoring", label: "Scoring Data" })
                }
              >
                Purge Scoring Data
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setPurgeDialog({ open: true, scope: "enrichment", label: "Enrichment History" })
                }
              >
                Purge Enrichment History
              </Button>
            </div>
            {purgeResult && (
              <p className="text-sm text-muted-foreground">
                {purgeResult.deleted >= 0
                  ? `Purged ${purgeResult.deleted} record(s) from ${purgeResult.scope}.`
                  : `Purge of ${purgeResult.scope} failed. The endpoint may not be deployed.`}
              </p>
            )}
          </CardContent>
        </Card>

        {/* GDPR Erasure */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <CardTitle className="text-base">GDPR Erasure</CardTitle>
            </div>
            <CardDescription>
              Permanently erase all data for a specific contact. This action is irreversible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Input
                placeholder="Contact ID (UUID)"
                value={erasureId}
                onChange={(e) => {
                  setErasureId(e.target.value);
                  setErasureConfirm(false);
                  setErasureResult(null);
                }}
                className="max-w-sm"
              />
              {!erasureConfirm ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!erasureId.trim()}
                  onClick={() => setErasureConfirm(true)}
                >
                  Erase All Data
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={erasing}
                  onClick={handleErasure}
                >
                  {erasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Erasure
                </Button>
              )}
            </div>
            {erasureConfirm && !erasing && (
              <p className="text-sm text-destructive">
                Are you sure? Click &quot;Confirm Erasure&quot; to permanently delete all
                data for this contact.
              </p>
            )}
            {erasureResult && (
              <p className="text-sm text-muted-foreground">{erasureResult}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reindex progress dialog */}
      <Dialog open={reindexOpen} onOpenChange={(open) => { if (!reindexing) setReindexOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reindexing ? "Reindexing..." : "Reindex Complete"}
            </DialogTitle>
            <DialogDescription>
              {reindexing
                ? "Processing your data. This may take a few minutes for large datasets."
                : "All reindex phases have completed."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {reindexPhases.map((phase, i) => {
              const label = PHASE_LABELS[phase.phase] || phase.phase;
              const pct = phase.total && phase.total > 0
                ? Math.round(((phase.current ?? 0) / phase.total) * 100)
                : phase.status === "complete" ? 100 : 0;

              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    {phase.status === "complete" ? (
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    ) : phase.status === "error" ? (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-medium">{label}</span>
                    {phase.status === "complete" && phase.generated !== undefined && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {phase.generated} generated, {phase.skipped} skipped
                        {phase.errors ? `, ${phase.errors} errors` : ""}
                      </span>
                    )}
                    {phase.status === "complete" && phase.total !== undefined && phase.generated === undefined && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {phase.total} items
                      </span>
                    )}
                  </div>
                  {phase.status === "progress" && (
                    <Progress value={pct} className="h-2" />
                  )}
                  {phase.detail && phase.status !== "complete" && (
                    <p className="text-xs text-muted-foreground">{phase.detail}</p>
                  )}
                </div>
              );
            })}
          </div>
          {!reindexing && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setReindexOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Purge confirmation dialog */}
      <Dialog
        open={purgeDialog.open}
        onOpenChange={(open) => {
          if (!open) setPurgeDialog({ open: false, scope: "", label: "" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Purge</DialogTitle>
            <DialogDescription>
              You are about to permanently delete all {purgeDialog.label}. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurgeDialog({ open: false, scope: "", label: "" })}
            >
              Cancel
            </Button>
            <Button variant="destructive" disabled={purging} onClick={handlePurge}>
              {purging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Purge {purgeDialog.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
