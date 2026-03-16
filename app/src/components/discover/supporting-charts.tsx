"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  criteria: Record<string, unknown>;
}

interface SupportingChartsProps {
  niches: NicheData[];
  selectedNiche: string | null;
  selectedIcp: string | null;
  icps: IcpData[];
}

export function SupportingCharts({
  niches,
  selectedNiche,
  selectedIcp,
  icps,
}: SupportingChartsProps) {
  // Tier distribution pie
  const tierData = (() => {
    const source = selectedNiche
      ? niches.find((n) => n.name === selectedNiche)
      : null;

    if (source) {
      return Object.entries(source.tierBreakdown)
        .filter(([, v]) => v > 0)
        .map(([tier, count]) => ({
          name: tier.charAt(0).toUpperCase() + tier.slice(1),
          value: count,
          color: TIER_COLORS[tier] || TIER_COLORS.unscored,
        }));
    }

    // Aggregate all niches
    const agg: Record<string, number> = {};
    for (const n of niches) {
      for (const [tier, count] of Object.entries(n.tierBreakdown)) {
        agg[tier] = (agg[tier] || 0) + count;
      }
    }
    return Object.entries(agg)
      .filter(([, v]) => v > 0)
      .map(([tier, count]) => ({
        name: tier.charAt(0).toUpperCase() + tier.slice(1),
        value: count,
        color: TIER_COLORS[tier] || TIER_COLORS.unscored,
      }));
  })();

  // Niche size bar chart
  const nicheBarData = niches.slice(0, 8).map((n) => ({
    name: n.name.length > 12 ? n.name.slice(0, 12) + "..." : n.name,
    contacts: n.contactCount,
    fill: selectedNiche === n.name ? "#8b5cf6" : "#6366f1",
  }));

  // ICP dimension radar
  const radarData = (() => {
    const icp = icps.find((i) => i.id === selectedIcp);
    if (!icp?.criteria) return [];

    const dims = [
      { key: "roles", label: "Roles" },
      { key: "industries", label: "Industries" },
      { key: "companySizeRanges", label: "Company Size" },
      { key: "locations", label: "Locations" },
      { key: "signals", label: "Signals" },
      { key: "minConnections", label: "Connections" },
    ];

    return dims.map((d) => {
      const val = icp.criteria[d.key];
      let score = 0;
      if (Array.isArray(val)) {
        score = Math.min(val.length * 30, 100);
      } else if (typeof val === "number" && val > 0) {
        score = Math.min(val / 5, 100);
      }
      return { dimension: d.label, value: score };
    });
  })();

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Tier distribution pie */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium">
            Tier Distribution
            {selectedNiche && (
              <span className="text-muted-foreground font-normal"> - {selectedNiche}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tierData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={tierData}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={55}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {tierData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
              No tier data
            </div>
          )}
        </CardContent>
      </Card>

      {/* Niche size bar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium">Niche Sizes</CardTitle>
        </CardHeader>
        <CardContent>
          {nicheBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={nicheBarData} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={80}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip />
                <Bar dataKey="contacts" radius={[0, 4, 4, 0]}>
                  {nicheBarData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
              No niche data
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dimension radar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium">ICP Dimensions</CardTitle>
        </CardHeader>
        <CardContent>
          {radarData.length > 0 && radarData.some((d) => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={160}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                <PolarGrid stroke="currentColor" className="text-border" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fontSize: 9, fill: "currentColor" }}
                  className="text-muted-foreground"
                />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  dataKey="value"
                  stroke="#8b5cf6"
                  fill="#8b5cf6"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
              Select an ICP to see dimensions
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
