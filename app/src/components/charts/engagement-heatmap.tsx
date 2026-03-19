"use client";

import { useMemo } from "react";
import { Group } from "@visx/group";
import { HeatmapRect } from "@visx/heatmap";
import { scaleLinear, scaleBand } from "@visx/scale";
import { useParentSize } from "@visx/responsive";

interface HeatmapDatum {
  day: number;
  hour: number;
  value: number;
}

interface EngagementHeatmapProps {
  data: HeatmapDatum[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function EngagementHeatmap({ data }: EngagementHeatmapProps) {
  const { parentRef, width } = useParentSize({ debounceTime: 150 });

  const margin = { top: 20, left: 40, right: 10, bottom: 30 };
  const cellHeight = 24;
  const svgHeight = margin.top + margin.bottom + 7 * cellHeight;
  const innerWidth = Math.max(width - margin.left - margin.right, 10);
  const innerHeight = 7 * cellHeight;

  const { bins, maxValue } = useMemo(() => {
    // Group data by day (rows) with hour bins (columns)
    const lookup = new Map<string, number>();
    let mv = 0;
    for (const d of data) {
      const key = `${d.day}-${d.hour}`;
      lookup.set(key, (lookup.get(key) ?? 0) + d.value);
      mv = Math.max(mv, lookup.get(key)!);
    }

    const binData = Array.from({ length: 7 }, (_, day) => ({
      bin: day,
      bins: Array.from({ length: 24 }, (__, hour) => ({
        bin: hour,
        count: lookup.get(`${day}-${hour}`) ?? 0,
      })),
    }));

    return { bins: binData, maxValue: mv };
  }, [data]);

  const xScale = scaleBand<number>({
    domain: Array.from({ length: 24 }, (_, i) => i),
    range: [0, innerWidth],
    padding: 0.05,
  });

  const yScale = scaleBand<number>({
    domain: Array.from({ length: 7 }, (_, i) => i),
    range: [0, innerHeight],
    padding: 0.05,
  });

  const colorScale = scaleLinear<string>({
    domain: [0, maxValue || 1],
    range: ["#dbeafe", "#1e40af"],
  });

  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No engagement data available
      </p>
    );
  }

  return (
    <div ref={parentRef} style={{ width: "100%" }}>
      {width > 0 && (
        <svg width={width} height={svgHeight}>
          <Group top={margin.top} left={margin.left}>
            <HeatmapRect
              data={bins}
              xScale={(columnIndex: number) => xScale(columnIndex) ?? 0}
              yScale={(rowIndex: number) => yScale(rowIndex) ?? 0}
              colorScale={colorScale}
              binWidth={xScale.bandwidth()}
              binHeight={yScale.bandwidth()}
              gap={1}
            >
              {(heatmap) =>
                heatmap.map((heatmapBins) =>
                  heatmapBins.map((bin) => (
                    <rect
                      key={`rect-${bin.row}-${bin.column}`}
                      x={bin.x}
                      y={bin.y}
                      width={bin.width}
                      height={bin.height}
                      fill={bin.color}
                      rx={2}
                    >
                      <title>
                        {DAY_LABELS[bin.row]} {bin.column}:00 - {bin.count}
                      </title>
                    </rect>
                  ))
                )
              }
            </HeatmapRect>
            {/* Y-axis labels */}
            {DAY_LABELS.map((label, i) => (
              <text
                key={label}
                x={-6}
                y={(yScale(i) ?? 0) + yScale.bandwidth() / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {label}
              </text>
            ))}
            {/* X-axis labels (every 3 hours) */}
            {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
              <text
                key={h}
                x={(xScale(h) ?? 0) + xScale.bandwidth() / 2}
                y={innerHeight + 14}
                textAnchor="middle"
                fontSize={9}
                fill="hsl(var(--muted-foreground))"
              >
                {h}:00
              </text>
            ))}
          </Group>
        </svg>
      )}
    </div>
  );
}
