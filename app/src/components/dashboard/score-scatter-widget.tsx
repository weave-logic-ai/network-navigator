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
                c.composite_score !== null && c.composite_score !== undefined
            )
            .map(
              (c: {
                full_name?: string;
                composite_score?: number;
                tier?: string;
                connections_count?: number;
              }) => ({
                name: c.full_name || "Unknown",
                compositeScore: c.composite_score ?? 0,
                referralLikelihood: Math.random() * 0.5 + (c.composite_score ?? 0) * 0.5,
                connections: c.connections_count ?? 50,
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
