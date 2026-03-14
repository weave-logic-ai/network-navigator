"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface BudgetStatus {
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  utilizationPercent: number;
  isWarning: boolean;
  isExhausted: boolean;
  lookupCount: number;
}

export function EnrichmentBudgetBars() {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/enrichment/budget");
        if (res.ok) {
          const json = await res.json();
          setStatus(json.data);
        }
      } catch {
        // Empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Enrichment Budget</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : !status || status.budgetCents === 0 ? (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            No budget period configured
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>
                  ${(status.spentCents / 100).toFixed(2)} / $
                  {(status.budgetCents / 100).toFixed(2)}
                </span>
                <span
                  className={
                    status.isWarning
                      ? "text-orange-600"
                      : "text-muted-foreground"
                  }
                >
                  {status.utilizationPercent.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={status.utilizationPercent}
                className={status.isWarning ? "bg-orange-100" : undefined}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{status.lookupCount} lookups</span>
              <span>
                ${(status.remainingCents / 100).toFixed(2)} remaining
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
