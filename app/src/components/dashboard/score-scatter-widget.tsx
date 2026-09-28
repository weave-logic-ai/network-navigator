"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreScatter } from "@/components/charts/score-scatter";

interface ScatterContact {
  name: string;
  compositeScore: number;
  referralLikelihood: number;
  connections: number;
  tier: string;
}

export function ScoreScatterWidget() {
  const [data, setData] = useState<ScatterContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          "/api/contacts?sort=score&order=desc&limit=50"
        );
        if (res.ok) {
          const json = await res.json();
          const contacts: ScatterContact[] = (json.data || [])
            .filter(
              (c: Record<string, unknown>) =>
                typeof c.compositeScore === "number" &&
                typeof c.referralLikelihood === "number"
            )
            .map(
              (c: {
                fullName?: string;
                compositeScore?: number;
                referralLikelihood?: number;
                tier?: string;
                connectionsCount?: number;
              }) => ({
                name: c.fullName || "Unknown",
                compositeScore: c.compositeScore ?? 0,
                referralLikelihood: c.referralLikelihood ?? 0,
                connections: c.connectionsCount ?? 0,
                tier: c.tier || "watch",
              })
            );
          setData(contacts);
        }
      } catch {
        // empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Score Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : (
          <ScoreScatter data={data} />
        )}
      </CardContent>
    </Card>
  );
}
