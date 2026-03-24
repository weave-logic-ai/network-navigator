"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface DimensionRadarDatum {
  dimension: string;
  label: string;
  value: number;
  fullMark: number;
}

interface DimensionRadarProps {
  dimensions: Array<{
    dimension: string;
    rawValue: number;
    weight: number;
  }>;
  labels?: Record<string, string>;
  /** Show a faint outline for the "ideal" (all-1.0) profile */
  showIdeal?: boolean;
}

const DEFAULT_LABELS: Record<string, string> = {
  icp_fit: "ICP Fit",
  network_hub: "Network Hub",
  relationship_strength: "Relationship",
  signal_boost: "Signal Boost",
  skills_relevance: "Skills",
  network_proximity: "Proximity",
  behavioral: "Behavioral",
  content_relevance: "Content",
  graph_centrality: "Centrality",
};

export function DimensionRadar({
  dimensions,
  labels = DEFAULT_LABELS,
  showIdeal = true,
}: DimensionRadarProps) {
  if (!dimensions || dimensions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No dimension data available
      </p>
    );
  }

  const data: DimensionRadarDatum[] = dimensions.map((d) => ({
    dimension: d.dimension,
    label: labels[d.dimension] || d.dimension,
    value: Math.round(d.rawValue * 100),
    fullMark: 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
        />
        <PolarRadiusAxis
          domain={[0, 100]}
          tickCount={5}
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => `${v}%`}
        />
        {showIdeal && (
          <Radar
            name="Ideal"
            dataKey="fullMark"
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.2}
            fill="none"
            strokeDasharray="4 4"
          />
        )}
        <Radar
          name="Score"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeWidth={2}
          dot={{ r: 3, fill: "hsl(var(--primary))" }}
          activeDot={{ r: 5 }}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            fontSize: "12px",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => [`${Number(value)}%`, "Score"]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
