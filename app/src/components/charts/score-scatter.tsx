"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
} from "recharts";

interface ScatterDatum {
  name: string;
  compositeScore: number;
  referralLikelihood: number;
  connections: number;
  tier: string;
}

interface ScoreScatterProps {
  data: ScatterDatum[];
}

const TIER_COLORS: Record<string, string> = {
  gold: "#FFD700",
  silver: "#C0C0C0",
  bronze: "#CD7F32",
  watch: "#888888",
};

function getTierColor(tier: string): string {
  return TIER_COLORS[tier.toLowerCase()] ?? "#888888";
}

export function ScoreScatter({ data }: ScoreScatterProps) {
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No score data available
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
        <XAxis
          dataKey="compositeScore"
          type="number"
          name="Composite Score"
          domain={[0, 1]}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          fontSize={11}
          label={{
            value: "Composite Score",
            position: "insideBottom",
            offset: -10,
            fontSize: 11,
          }}
        />
        <YAxis
          dataKey="referralLikelihood"
          type="number"
          name="Referral Likelihood"
          domain={[0, 1]}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          fontSize={11}
          label={{
            value: "Referral Likelihood",
            angle: -90,
            position: "insideLeft",
            fontSize: 11,
          }}
        />
        <ZAxis
          dataKey="connections"
          type="number"
          range={[40, 400]}
          name="Connections"
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            fontSize: "12px",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => {
            if (name === "Composite Score" || name === "Referral Likelihood") {
              return [`${(Number(value) * 100).toFixed(1)}%`, name];
            }
            return [value, name];
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          labelFormatter={(_: any, payload: any) => {
            const item = payload?.[0]?.payload;
            return item ? item.name : "";
          }}
        />
        <Scatter data={data} isAnimationActive>
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={getTierColor(entry.tier)}
              stroke={getTierColor(entry.tier)}
              strokeWidth={1}
              fillOpacity={0.7}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
