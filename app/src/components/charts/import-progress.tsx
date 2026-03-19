"use client";

import { useMemo } from "react";
import { Arc } from "@visx/shape";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { useParentSize } from "@visx/responsive";

interface ImportProgressProps {
  totalRows: number;
  processedRows: number;
  duplicates: number;
  errors: number;
  status: "idle" | "running" | "complete" | "error";
}

const TAU = 2 * Math.PI;

interface Segment {
  label: string;
  value: number;
  color: string;
}

export function ImportProgress({
  totalRows,
  processedRows,
  duplicates,
  errors,
  status,
}: ImportProgressProps) {
  const { parentRef, width } = useParentSize({ debounceTime: 150 });

  const size = Math.min(width || 240, 240);
  const outerRadius = size / 2 - 8;
  const innerRadius = outerRadius * 0.65;

  const segments: Segment[] = useMemo(() => {
    const successCount = Math.max(processedRows - duplicates - errors, 0);
    const remaining = Math.max(totalRows - processedRows, 0);
    return [
      { label: "Processed", value: successCount, color: "#22c55e" },
      { label: "Duplicates", value: duplicates, color: "#eab308" },
      { label: "Errors", value: errors, color: "#ef4444" },
      { label: "Remaining", value: remaining, color: "#e5e7eb" },
    ];
  }, [totalRows, processedRows, duplicates, errors]);

  const arcs = useMemo(() => {
    const total = Math.max(totalRows, 1);
    let cumAngle = -Math.PI / 2; // start at top
    return segments.map((seg) => {
      const angle = (seg.value / total) * TAU;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;
      return { ...seg, startAngle, endAngle };
    });
  }, [segments, totalRows]);

  const pct =
    totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : 0;

  const statusLabel =
    status === "idle"
      ? "Idle"
      : status === "running"
        ? "Running..."
        : status === "complete"
          ? "Complete"
          : "Error";

  return (
    <div ref={parentRef} style={{ width: "100%" }}>
      <svg width={size} height={size} style={{ margin: "0 auto", display: "block" }}>
        <Group top={size / 2} left={size / 2}>
          {arcs.map((arc) =>
            arc.value > 0 ? (
              <Arc
                key={arc.label}
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                startAngle={arc.startAngle}
                endAngle={arc.endAngle}
                padAngle={0.02}
                cornerRadius={3}
                fill={arc.color}
              />
            ) : null
          )}
          <Text
            textAnchor="middle"
            verticalAnchor="middle"
            dy={-6}
            fontSize={24}
            fontWeight={700}
            fill="hsl(var(--foreground))"
          >
            {`${pct}%`}
          </Text>
          <Text
            textAnchor="middle"
            verticalAnchor="middle"
            dy={14}
            fontSize={11}
            fill="hsl(var(--muted-foreground))"
          >
            {statusLabel}
          </Text>
        </Group>
      </svg>
      <div className="flex justify-center gap-4 mt-2">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}: {s.value}
            </div>
          ))}
      </div>
    </div>
  );
}
