"use client";

import { useMemo, useState, useCallback } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleOrdinal } from "@visx/scale";
import { Arc } from "@visx/shape";
import { Text } from "@visx/text";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { ParentSize } from "@visx/responsive";
import { LinearGradient } from "@visx/gradient";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#9ca3af",
  bronze: "#f97316",
  watch: "#3b82f6",
  unscored: "#6b7280",
};

const NICHE_COLORS = [
  "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6",
  "#f97316", "#84cc16", "#0ea5e9", "#a855f7",
];

interface NicheData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  topContacts: Array<{ id: string; name: string; score: number; tier: string }>;
}

interface WedgeChartProps {
  niches: NicheData[];
  totalContacts: number;
  selectedNiche: string | null;
  onNicheSelect: (name: string | null) => void;
}

interface WedgeArc {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  color: string;
  index: number;
}

interface TierArc {
  tier: string;
  count: number;
  parentName: string;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  color: string;
}

interface TooltipData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
}

const tooltipStyles = {
  ...defaultStyles,
  backgroundColor: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  padding: "8px 12px",
  fontSize: "13px",
  boxShadow: "0 4px 6px -1px rgba(0,0,0,.1)",
};

function WedgeChartInner({
  niches,
  totalContacts,
  selectedNiche,
  onNicheSelect,
  width,
  height,
}: WedgeChartProps & { width: number; height: number }) {
  const [hoveredNiche, setHoveredNiche] = useState<string | null>(null);
  const { tooltipOpen, tooltipLeft, tooltipTop, tooltipData, showTooltip, hideTooltip } =
    useTooltip<TooltipData>();

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;
  const innerR = radius * 0.28;
  const midR = radius * 0.62;
  const outerR = radius * 0.88;

  const scoreScale = useMemo(() => {
    const maxScore = Math.max(...niches.map((n) => n.avgScore), 1);
    return scaleLinear({ domain: [0, maxScore], range: [midR * 0.7, midR] });
  }, [niches, midR]);

  const colorScale = useMemo(
    () =>
      scaleOrdinal({
        domain: niches.map((n) => n.name),
        range: NICHE_COLORS.slice(0, niches.length),
      }),
    [niches]
  );

  // Build main wedge arcs (outer ring: contact count proportional angle)
  const wedgeArcs: WedgeArc[] = useMemo(() => {
    if (niches.length === 0) return [];
    const totalCount = niches.reduce((s, n) => s + n.contactCount, 0) || 1;
    const gap = 0.02;
    let angle = -Math.PI;

    return niches.map((n, i) => {
      const sweep = ((n.contactCount / totalCount) * Math.PI * 2) - gap;
      const start = angle;
      const end = angle + Math.max(sweep, 0.05);
      angle = end + gap;

      const dynamicOuter = scoreScale(n.avgScore);

      return {
        name: n.name,
        contactCount: n.contactCount,
        avgScore: n.avgScore,
        tierBreakdown: n.tierBreakdown,
        startAngle: start,
        endAngle: end,
        innerRadius: innerR,
        outerRadius: dynamicOuter,
        color: colorScale(n.name),
        index: i,
      };
    });
  }, [niches, innerR, scoreScale, colorScale]);

  // Build tier sub-arcs (outer ring)
  const tierArcs: TierArc[] = useMemo(() => {
    const arcs: TierArc[] = [];
    for (const wedge of wedgeArcs) {
      const tiers = Object.entries(wedge.tierBreakdown).filter(([, v]) => v > 0);
      if (tiers.length === 0) continue;
      const totalInWedge = tiers.reduce((s, [, v]) => s + v, 0) || 1;
      let tierAngle = wedge.startAngle;
      const wedgeSweep = wedge.endAngle - wedge.startAngle;

      for (const [tier, count] of tiers) {
        const tierSweep = (count / totalInWedge) * wedgeSweep;
        arcs.push({
          tier,
          count,
          parentName: wedge.name,
          startAngle: tierAngle,
          endAngle: tierAngle + tierSweep,
          innerRadius: wedge.outerRadius + 2,
          outerRadius: outerR,
          color: TIER_COLORS[tier] || TIER_COLORS.unscored,
        });
        tierAngle += tierSweep;
      }
    }
    return arcs;
  }, [wedgeArcs, outerR]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent, data: TooltipData) => {
      showTooltip({
        tooltipData: data,
        tooltipLeft: event.clientX,
        tooltipTop: event.clientY,
      });
    },
    [showTooltip]
  );

  if (niches.length === 0) {
    return (
      <div className="flex h-[350px] items-center justify-center text-sm text-muted-foreground">
        No niche data available. Import contacts and run discovery first.
      </div>
    );
  }

  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height}>
        <LinearGradient id="wedge-bg" from="#1e1b4b" to="#0f172a" fromOpacity={0.05} toOpacity={0.02} />
        <rect width={width} height={height} fill="url(#wedge-bg)" rx={8} />

        <Group top={centerY} left={centerX}>
          {/* Main niche wedges */}
          {wedgeArcs.map((arc) => {
            const isSelected = selectedNiche === arc.name;
            const isHovered = hoveredNiche === arc.name;
            const isDimmed = selectedNiche && !isSelected;
            const opacity = isDimmed ? 0.25 : isHovered ? 1 : 0.85;

            return (
              <Arc
                key={arc.name}
                startAngle={arc.startAngle}
                endAngle={arc.endAngle}
                innerRadius={arc.innerRadius}
                outerRadius={arc.outerRadius}
                fill={arc.color}
                opacity={opacity}
                stroke={isSelected ? "hsl(var(--foreground))" : "transparent"}
                strokeWidth={isSelected ? 2 : 0}
                cornerRadius={3}
                cursor="pointer"
                onClick={() =>
                  onNicheSelect(selectedNiche === arc.name ? null : arc.name)
                }
                onMouseEnter={() => setHoveredNiche(arc.name)}
                onMouseLeave={() => {
                  setHoveredNiche(null);
                  hideTooltip();
                }}
                onMouseMove={(e) =>
                  handleMouseMove(e, {
                    name: arc.name,
                    contactCount: arc.contactCount,
                    avgScore: arc.avgScore,
                    tierBreakdown: arc.tierBreakdown,
                  })
                }
              />
            );
          })}

          {/* Tier sub-arcs (outer ring) */}
          {tierArcs.map((arc, i) => {
            const isDimmed = selectedNiche && selectedNiche !== arc.parentName;
            return (
              <Arc
                key={`tier-${i}`}
                startAngle={arc.startAngle}
                endAngle={arc.endAngle}
                innerRadius={arc.innerRadius}
                outerRadius={arc.outerRadius}
                fill={arc.color}
                opacity={isDimmed ? 0.15 : 0.7}
                cornerRadius={2}
              />
            );
          })}

          {/* Niche labels on wedges */}
          {wedgeArcs.map((arc) => {
            const midAngle = (arc.startAngle + arc.endAngle) / 2;
            const labelR = (arc.innerRadius + arc.outerRadius) / 2;
            const x = Math.cos(midAngle - Math.PI / 2) * labelR;
            const y = Math.sin(midAngle - Math.PI / 2) * labelR;
            const sweep = arc.endAngle - arc.startAngle;
            if (sweep < 0.3) return null;

            return (
              <Text
                key={`label-${arc.name}`}
                x={x}
                y={y}
                textAnchor="middle"
                verticalAnchor="middle"
                fill="white"
                fontSize={sweep > 0.6 ? 11 : 9}
                fontWeight={600}
                style={{ pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,.5)" }}
              >
                {arc.name.length > 14 ? arc.name.slice(0, 12) + "..." : arc.name}
              </Text>
            );
          })}

          {/* Center label */}
          <Text
            textAnchor="middle"
            verticalAnchor="middle"
            fill="hsl(var(--foreground))"
            fontSize={22}
            fontWeight={700}
            dy={-6}
          >
            {totalContacts}
          </Text>
          <Text
            textAnchor="middle"
            verticalAnchor="middle"
            fill="hsl(var(--muted-foreground))"
            fontSize={11}
            dy={14}
          >
            contacts
          </Text>
        </Group>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {niches.map((n, i) => (
          <button
            key={n.name}
            className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"
            onClick={() => onNicheSelect(selectedNiche === n.name ? null : n.name)}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: NICHE_COLORS[i % NICHE_COLORS.length] }}
            />
            <span className="text-muted-foreground">{n.name}</span>
          </button>
        ))}
      </div>

      {/* Tier legend */}
      <div className="absolute top-2 right-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {Object.entries(TIER_COLORS)
          .filter(([t]) => t !== "unscored")
          .map(([tier, color]) => (
            <span key={tier} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground capitalize">{tier}</span>
            </span>
          ))}
      </div>

      {/* Tooltip */}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          top={tooltipTop}
          left={tooltipLeft}
          style={tooltipStyles}
        >
          <p className="font-medium">{tooltipData.name}</p>
          <p style={{ color: "hsl(var(--muted-foreground))" }}>
            {tooltipData.contactCount} contacts
          </p>
          <p style={{ color: "hsl(var(--muted-foreground))" }}>
            Avg score: {tooltipData.avgScore.toFixed(1)}
          </p>
          <div className="mt-1 flex gap-2 text-xs">
            {Object.entries(tooltipData.tierBreakdown)
              .filter(([, v]) => v > 0)
              .map(([tier, count]) => (
                <span key={tier} style={{ color: TIER_COLORS[tier] }}>
                  {tier}: {count}
                </span>
              ))}
          </div>
        </TooltipWithBounds>
      )}
    </div>
  );
}

export function WedgeChart(props: WedgeChartProps) {
  return (
    <ParentSize debounceTime={100}>
      {({ width }) => (
        <WedgeChartInner {...props} width={Math.max(width, 300)} height={380} />
      )}
    </ParentSize>
  );
}
