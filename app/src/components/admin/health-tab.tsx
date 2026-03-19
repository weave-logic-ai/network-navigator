"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2 } from "lucide-react";

interface HealthData {
  db: { connected: boolean; tables: Record<string, number> };
  providers: Array<{ name: string; active: boolean }>;
  lastEnrichment: string | null;
  lastScoring: string | null;
}

export function HealthTab() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function loadHealth() {
      try {
        const res = await fetch("/api/admin/health");
        if (!res.ok) throw new Error("unavailable");
        const json = await res.json();
        setHealth(json.data);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    loadHealth();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !health) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            System health endpoint unavailable. It may not be deployed yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* DB Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <CardTitle className="text-base">Database</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                health.db.connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm">
              {health.db.connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          {health.db.tables && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {Object.entries(health.db.tables).map(([table, count]) => (
                <div key={table} className="rounded border p-2 text-center">
                  <p className="text-xs text-muted-foreground truncate">{table}</p>
                  <p className="text-sm font-medium tabular-nums">
                    {count.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Providers */}
      {health.providers && health.providers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Provider Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {health.providers.map((p) => (
                <Badge key={p.name} variant={p.active ? "default" : "secondary"}>
                  {p.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last activity timestamps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Last Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Last Enrichment</p>
              <p className="text-sm">
                {health.lastEnrichment
                  ? new Date(health.lastEnrichment).toLocaleString()
                  : "N/A"}
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Last Scoring Run</p>
              <p className="text-sm">
                {health.lastScoring
                  ? new Date(health.lastScoring).toLocaleString()
                  : "N/A"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
