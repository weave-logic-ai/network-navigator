"use client";

import { useMemo, useState } from "react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";

const NICHE_COLORS = [
  "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6",
  "#f97316", "#84cc16", "#0ea5e9", "#a855f7",
];

const ICP_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444", "#f97316",
  "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
];

interface NicheData {
  id?: string;
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
}

interface IcpData {
  id: string;
  name: string;
  nicheId?: string | null;
  matchCount: number;
  firstDegreeCount: number;
  secondDegreeCount: number;
}

interface IcpTreemapProps {
  niches: NicheData[];
  icps: IcpData[];
  selectedIcp: string | null;
  onIcpSelect: (id: string | null) => void;
}

interface TreemapTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      size: number;
      type?: string;
      matchCount?: number;
      firstDegreeCount?: number;
      contactCount?: number;
      avgScore?: number;
    };
  }>;
}

function TreemapTooltipContent({ active, payload }: TreemapTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{d.name}</p>
      <p className="text-muted-foreground">
        {d.matchCount !== undefined ? `${d.matchCount} matches` : `${d.contactCount ?? d.size} contacts`}
      </p>
      {d.avgScore !== undefined && d.avgScore > 0 && (
        <p className="text-muted-foreground">Avg score: {d.avgScore.toFixed(1)}</p>
      )}
      {d.firstDegreeCount !== undefined && d.firstDegreeCount > 0 && (
        <p className="text-muted-foreground">1st degree: {d.firstDegreeCount}</p>
      )}
    </div>
  );
}

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  color?: string;
}

function CustomTreemapContent({ x = 0, y = 0, width = 0, height = 0, name = "", color = "#6b7280" }: TreemapContentProps) {
  if (width < 20 || height < 16) return null;
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        fill={color}
        stroke="hsl(var(--background))"
        strokeWidth={2}
        rx={4}
        style={{ cursor: "pointer" }}
      />
      {width > 40 && height > 24 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={Math.min(12, width / 8)}
          fontWeight={600}
        >
          {name.length > width / 7 ? `${name.slice(0, Math.floor(width / 7))}...` : name}
        </text>
      )}
    </g>
  );
}

export function IcpTreemap({
  niches,
  icps,
  selectedIcp,
  onIcpSelect,
}: IcpTreemapProps) {
  const [mode, setMode] = useState<"niches" | "icps">("niches");

  const treeData = useMemo(() => {
    if (mode === "icps") {
      const filtered = icps.filter(i => i.matchCount > 0);
      if (filtered.length === 0) {
        return icps.map((icp, i) => ({
          name: icp.name,
          size: 1,
          color: selectedIcp === icp.id ? ICP_COLORS[i % ICP_COLORS.length] : selectedIcp ? `${ICP_COLORS[i % ICP_COLORS.length]}40` : ICP_COLORS[i % ICP_COLORS.length],
          matchCount: icp.matchCount,
          firstDegreeCount: icp.firstDegreeCount,
          icpId: icp.id,
        }));
      }
      return filtered.map((icp, i) => ({
        name: icp.name,
        size: icp.matchCount,
        color: selectedIcp === icp.id ? ICP_COLORS[i % ICP_COLORS.length] : selectedIcp ? `${ICP_COLORS[i % ICP_COLORS.length]}40` : ICP_COLORS[i % ICP_COLORS.length],
        matchCount: icp.matchCount,
        firstDegreeCount: icp.firstDegreeCount,
        icpId: icp.id,
      }));
    }

    // Niche mode
    const filtered = niches.filter(n => n.contactCount > 0);
    if (filtered.length === 0) {
      return niches.map((n, i) => ({
        name: n.name,
        size: 1,
        color: NICHE_COLORS[i % NICHE_COLORS.length],
        contactCount: 0,
        avgScore: n.avgScore,
      }));
    }
    return filtered.map((n, i) => ({
      name: n.name,
      size: n.contactCount,
      color: NICHE_COLORS[i % NICHE_COLORS.length],
      contactCount: n.contactCount,
      avgScore: n.avgScore,
    }));
  }, [niches, icps, selectedIcp, mode]);

  if (treeData.length === 0) {
    return (
      <div className="flex h-[350px] items-center justify-center text-sm text-muted-foreground">
        No data available. Create niches or ICPs first.
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-1 mb-3">
        <Button
          size="sm"
          variant={mode === "niches" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setMode("niches")}
        >
          By Niche
        </Button>
        <Button
          size="sm"
          variant={mode === "icps" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setMode("icps")}
        >
          By ICP
        </Button>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <Treemap
          data={treeData}
          dataKey="size"
          nameKey="name"
          aspectRatio={4 / 3}
          stroke="hsl(var(--background))"
          content={<CustomTreemapContent />}
          onClick={(node) => {
            const data = node as unknown as { icpId?: string };
            if (data.icpId) {
              onIcpSelect(selectedIcp === data.icpId ? null : data.icpId);
            }
          }}
        >
          <Tooltip content={<TreemapTooltipContent />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
