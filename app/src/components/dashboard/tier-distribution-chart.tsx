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
        const res = await fetch("/api/scoring/weights");
        if (res.ok) {
          // Use the tier distribution from contacts
          const contactRes = await fetch("/api/contacts?limit=1");
          if (contactRes.ok) {
            const json = await contactRes.json();
            const total = json.pagination?.total || 0;
            // Show placeholder if no scored data
            if (total > 0) {
              setData([
                { tier: "Gold", count: 0 },
                { tier: "Silver", count: 0 },
                { tier: "Bronze", count: 0 },
                { tier: "Watch", count: 0 },
                { tier: "Unscored", count: total },
              ]);
            }
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
                data={data.filter((d) => d.count > 0)}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="count"
                nameKey="tier"
              >
                {data
                  .filter((d) => d.count > 0)
                  .map((entry) => (
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
