"use client";

import { cn } from "@/lib/utils";

const DIMENSION_LABELS: Record<string, string> = {
  icp_fit: "ICP Fit",
  network_hub: "Network Hub",
  relationship_strength: "Relationship Strength",
  signal_boost: "Signal Boost",
  skills_relevance: "Skills Relevance",
  network_proximity: "Network Proximity",
  behavioral: "Behavioral",
  content_relevance: "Content Relevance",
  graph_centrality: "Graph Centrality",
};

interface WeightSliderProps {
  dimension: string;
  value: number;
  onChange: (dimension: string, value: number) => void;
}

export function WeightSlider({ dimension, value, onChange }: WeightSliderProps) {
  const label = DIMENSION_LABELS[dimension] ?? dimension;
  const percent = Math.round(value * 100);

  return (
    <div className="flex items-center gap-4">
      <label className="w-44 shrink-0 text-sm font-medium">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => onChange(dimension, parseInt(e.target.value, 10) / 100)}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4",
          "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0",
          "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow"
        )}
      />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  );
}

export { DIMENSION_LABELS };
