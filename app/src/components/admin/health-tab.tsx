"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, RefreshCw } from "lucide-react";

interface HealthData {
  status: "healthy" | "degraded";
  checks: {
    db: { connected: boolean; latencyMs?: number };
    providers: Array<{ name: string; active: boolean }>;
    counts: Record<string, number>;
    diskUsage?: { dbSizeBytes: number; dbSizeHuman: string };
    parser?: { enabled: boolean; checked: boolean; lastRollupDay: string | null; error?: string };
  };
  error?: string;
}

export function interpretHealthResponse(httpStatus: number, body: unknown): HealthData {
  if (typeof body !== "object" || body === null) throw new Error("Invalid health response");
  const data = body as Partial<HealthData>;
  if (
    (data.status !== "healthy" && data.status !== "degraded") ||
    !data.checks ||
    typeof data.checks.db?.connected !== "boolean" ||
    !Array.isArray(data.checks.providers) ||
    typeof data.checks.counts !== "object" ||
    data.checks.counts === null
  ) throw new Error("Invalid health response");
  if (httpStatus >= 400 && (httpStatus !== 503 || data.status !== "degraded")) throw new Error(`Health request failed (HTTP ${httpStatus})`);
  return data as HealthData;
}

export function HealthTab() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      const body: unknown = await res.json();
      setHealth(interpretHealthResponse(res.status, body));
    } catch (cause) {
      setHealth(null);
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadHealth(); }, [loadHealth]);

  if (loading) {
    return <Card><CardContent className="flex items-center justify-center p-12" role="status">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />Loading system health…
    </CardContent></Card>;
  }

  if (error || !health) {
    return <Card><CardContent className="space-y-3 p-6" role="alert">
      <p className="font-medium">Health status unreachable</p>
      <p className="text-sm text-muted-foreground">The request could not be read. Check the app connection and server logs, then retry. {error}</p>
      <Button variant="outline" onClick={() => void loadHealth()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry health check</Button>
    </CardContent></Card>;
  }

  const { checks } = health;
  return <div className="space-y-4">
    <Card><CardContent className="space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="font-medium">System health: {health.status === "healthy" ? "Healthy" : "Degraded"}</p>
        <Button variant="outline" onClick={() => void loadHealth()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry health check</Button>
      </div>
      {health.status === "degraded" && <p className="text-sm text-muted-foreground">Review the checks below. Check database connectivity and server logs before retrying.{health.error ? ` Detail: ${health.error}` : ""}</p>}
    </CardContent></Card>

    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" aria-hidden="true" />Database</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{checks.db.connected ? "Connected" : "Disconnected"}{checks.db.latencyMs !== undefined ? ` · ${checks.db.latencyMs} ms` : ""}</p>
        {!checks.db.connected && <p className="text-sm text-muted-foreground">Check database service, connection settings, and server logs.</p>}
        {Object.keys(checks.counts).length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">{Object.entries(checks.counts).map(([table, count]) =>
          <div key={table} className="rounded border p-2"><p className="truncate text-xs text-muted-foreground">{table}</p><p className="text-sm font-medium tabular-nums">{count < 0 ? "Unavailable" : count.toLocaleString()}</p></div>
        )}</div>}
        {checks.diskUsage && <p className="text-sm text-muted-foreground">Database size: {checks.diskUsage.dbSizeHuman}</p>}
      </CardContent></Card>

    <Card><CardHeader className="pb-3"><CardTitle className="text-base">Providers</CardTitle></CardHeader><CardContent className="space-y-2">
      {checks.providers.length === 0 ? <p className="text-sm text-muted-foreground">No providers configured or available to report.</p> : checks.providers.map(provider =>
        <div key={provider.name} className="flex items-center gap-2"><span>{provider.name}</span><Badge variant={provider.active ? "default" : "secondary"}>{provider.active ? "Active" : "Inactive"}</Badge></div>
      )}
      {checks.providers.some(provider => !provider.active) && <p className="text-sm text-muted-foreground">Review provider configuration before running enrichment.</p>}
    </CardContent></Card>

    <Card><CardHeader className="pb-3"><CardTitle className="text-base">Parser telemetry</CardTitle></CardHeader><CardContent className="space-y-2">
      {!checks.parser ? <p>Status unavailable from this server version.</p> : !checks.parser.enabled ? <p>Disabled. Set RESEARCH_PARSER_TELEMETRY=true in the app environment and restart to collect parser outcomes.</p> : <>
        <p>Enabled · {checks.parser.error ? "Rollup check failed" : !checks.parser.checked ? "Rollup not checked" : `Last recorded rollup day: ${checks.parser.lastRollupDay ?? "None recorded"}`}</p>
        {checks.parser.error && <p role="alert">{checks.parser.error}. Check the telemetry table and server logs.</p>}
        {!checks.parser.checked && <p className="text-sm text-muted-foreground">Restore database health and retry to check the parser rollup.</p>}
        {checks.parser.checked && !checks.parser.error && !checks.parser.lastRollupDay && <p className="text-sm text-muted-foreground">After parses have been recorded, run the authorized parser rollup manually through operator tooling, then retry this check. No automatic schedule is confirmed.</p>}
      </>}
      <p className="text-sm"><Link href="/admin/parsers" className="underline">View parser yield report</Link></p>
    </CardContent></Card>
  </div>;
}
