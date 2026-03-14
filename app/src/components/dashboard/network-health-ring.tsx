"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HealthMetrics {
  totalContacts: number;
  withEmail: number;
  withCompany: number;
  withTitle: number;
  scored: number;
}

export function NetworkHealthRing() {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/contacts?limit=1");
        if (res.ok) {
          const json = await res.json();
          const total = json.pagination?.total || 0;
          // Approximate data maturity from available data
          setMetrics({
            totalContacts: total,
            withEmail: 0,
            withCompany: 0,
            withTitle: 0,
            scored: 0,
          });
        }
      } catch {
        // Empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const maturityPercent = metrics
    ? metrics.totalContacts > 0
      ? Math.round(
          ((metrics.withEmail + metrics.withCompany + metrics.withTitle + metrics.scored) /
            (metrics.totalContacts * 4)) *
            100
        )
      : 0
    : 0;

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
        ) : !metrics || metrics.totalContacts === 0 ? (
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
            <p className="text-xs text-muted-foreground mt-2">
              {metrics.totalContacts} contacts
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
