"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HealthData {
  totalContacts: number;
  totalEdges: number;
  avgScore: number;
  dataMaturity: number;
}

export function NetworkHealthRing() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const json = await res.json();
          const stats = json.data?.stats;
          const health = json.data?.networkHealth;
          if (stats && health) {
            setData({
              totalContacts: stats.totalContacts ?? 0,
              totalEdges: health.totalEdges ?? 0,
              avgScore: health.avgScore ?? 0,
              dataMaturity: health.dataMaturity ?? 0,
            });
          }
        }
      } catch {
        // Empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const maturityPercent = data?.dataMaturity ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Network Health</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : !data || data.totalContacts === 0 ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            Import contacts to see network health
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-32">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-muted/30"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${maturityPercent * 2.51} ${251 - maturityPercent * 2.51}`}
                  strokeDashoffset="62.75"
                  strokeLinecap="round"
                  className="text-primary"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold">{maturityPercent}%</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
              <span>{data.totalContacts} contacts</span>
              <span>{data.totalEdges} edges</span>
              {data.avgScore > 0 && (
                <span>avg {data.avgScore.toFixed(1)}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
