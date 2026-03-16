"use client";

import { useMemo } from "react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#9ca3af",
  bronze: "#f97316",
  watch: "#3b82f6",
  unscored: "#6b7280",
};

interface NicheData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
}

interface IcpData {
  id: string;
  name: string;
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

function getDominantTier(breakdown: Record<string, number>): string {
  let maxTier = "unscored";
  let maxCount = 0;
  for (const [tier, count] of Object.entries(breakdown)) {
    if (tier !== "unscored" && count > maxCount) {
      maxTier = tier;
      maxCount = count;
    }
  }
  return maxTier;
}

interface TreemapTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      size: number;
      avgScore?: number;
      matchCount?: number;
      firstDegreeCount?: number;
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
        {d.matchCount !== undefined ? `${d.matchCount} matches` : `${d.size} contacts`}
      </p>
      {d.avgScore !== undefined && (
        <p className="text-muted-foreground">Avg: {d.avgScore.toFixed(1)}</p>
      )}
      {d.firstDegreeCount !== undefined && (
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
  if (width < 30 || height < 20) return null;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        stroke="hsl(var(--background))"
        strokeWidth={2}
        rx={4}
        style={{ cursor: "pointer" }}
      />
      {width > 50 && height > 30 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={Math.min(12, width / 8)}
          fontWeight={500}
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
  const treeData = useMemo(() => {
    // If ICP profiles exist, show ICPs as primary rectangles
    if (icps.length > 0) {
      return icps.map((icp) => ({
        name: icp.name,
        size: Math.max(icp.matchCount, 1),
        color: selectedIcp === icp.id ? "#8b5cf6" : selectedIcp ? "#8b5cf640" : "#8b5cf6",
        matchCount: icp.matchCount,
        firstDegreeCount: icp.firstDegreeCount,
        icpId: icp.id,
      }));
    }

    // Otherwise show niches
    return niches.map((n) => ({
      name: n.name,
      size: n.contactCount,
      color: TIER_COLORS[getDominantTier(n.tierBreakdown)] || "#6b7280",
      avgScore: n.avgScore,
    }));
  }, [niches, icps, selectedIcp]);

  if (treeData.length === 0) {
    return (
      <div className="flex h-[350px] items-center justify-center text-sm text-muted-foreground">
        No data available for treemap. Import contacts first.
      </div>
    );
  }

  return (
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
  );
}
