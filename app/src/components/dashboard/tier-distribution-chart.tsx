"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#9ca3af",
  bronze: "#f97316",
  watch: "#3b82f6",
  unscored: "#6b7280",
};

interface TierData {
  tier: string;
  count: number;
}

export function TierDistributionChart() {
  const [data, setData] = useState<TierData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const json = await res.json();
          const dist = json.data?.stats?.tierDistribution;
          if (dist) {
            const items: TierData[] = [];
            for (const [tier, count] of Object.entries(dist)) {
              if (typeof count === "number" && count > 0) {
                items.push({
                  tier: tier.charAt(0).toUpperCase() + tier.slice(1),
                  count,
                });
              }
            }
            setData(items);
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

  const hasData = data.some((d) => d.count > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Tier Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : !hasData ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            No scored contacts yet. Run scoring to see distribution.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="count"
                nameKey="tier"
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.tier}
                    fill={
                      TIER_COLORS[entry.tier.toLowerCase()] || TIER_COLORS.unscored
                    }
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value: string) => (
                  <span className="text-xs">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
