"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DimensionParallelDatum {
  name: string;
  dimensions: Record<string, number>;
}

interface DimensionParallelProps {
  data: DimensionParallelDatum[];
}

const PALETTE = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#6366f1",
];

export function DimensionParallel({ data }: DimensionParallelProps) {
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No dimension data available
      </p>
    );
  }

  const contacts = data.slice(0, 10);

  // Collect all dimension keys
  const dimensionKeys = Array.from(
    new Set(contacts.flatMap((c) => Object.keys(c.dimensions)))
  );

  // Transform to recharts format: each row is a dimension, columns are contacts
  const chartData = dimensionKeys.map((dim) => {
    const row: Record<string, string | number> = { dimension: dim };
    contacts.forEach((c) => {
      row[c.name] = c.dimensions[dim] ?? 0;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={chartData}
        margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
      >
        <XAxis
          dataKey="dimension"
          fontSize={10}
          angle={-30}
          textAnchor="end"
          height={60}
          interval={0}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          fontSize={11}
          width={45}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            fontSize: "12px",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => `${(Number(value) * 100).toFixed(1)}%`}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px" }}
          iconSize={8}
        />
        {contacts.map((c, i) => (
          <Line
            key={c.name}
            type="monotone"
            dataKey={c.name}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
