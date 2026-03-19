"use client";

import {
  FunnelChart,
  Funnel,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";

interface FunnelDatum {
  stage: string;
  count: number;
}

interface OutreachFunnelProps {
  data: FunnelDatum[];
}

const COLORS = ["#3b82f6", "#2563eb", "#1d9f6f", "#16a34a", "#15803d"];

export function OutreachFunnel({ data }: OutreachFunnelProps) {
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No pipeline data available
      </p>
    );
  }

  const chartData = data.map((d, i) => ({
    ...d,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <FunnelChart>
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [value, name]}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            fontSize: "12px",
          }}
        />
        <Funnel dataKey="count" data={chartData} isAnimationActive>
          {chartData.map((entry, index) => (
            <Cell key={entry.stage} fill={COLORS[index % COLORS.length]} />
          ))}
          <LabelList
            position="right"
            dataKey="stage"
            fill="hsl(var(--foreground))"
            fontSize={12}
          />
          <LabelList
            position="center"
            dataKey="count"
            fill="#fff"
            fontSize={14}
            fontWeight={600}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
