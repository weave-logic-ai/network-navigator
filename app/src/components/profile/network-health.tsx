"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Target,
  Database,
  Activity,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

interface NetworkHealth {
  totalContacts: number;
  addressedContacts: number;
  addressedPct: number;
  scoredContacts: number;
  tierDistribution: {
    gold: number;
    silver: number;
    bronze: number;
    watch: number;
    unscored: number;
  };
  avgCompositeScore: number;
  relationshipDistribution: {
    strong: number;
    warm: number;
    cooling: number;
    dormant: number;
    unknown: number;
  };
  avgCompleteness: number;
  missingEmailCount: number;
  missingTitleCount: number;
  missingCompanyCount: number;
  embeddingCount: number;
  embeddingPct: number;
  recentConnections: number;
  activeGoals: number;
  pendingTasks: number;
  computedAt: string;
}

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#9ca3af",
  bronze: "#f97316",
  watch: "#3b82f6",
  unscored: "#6b7280",
};

const RELATIONSHIP_COLORS: Record<string, string> = {
  strong: "#22c55e",
  warm: "#eab308",
  cooling: "#f97316",
  dormant: "#ef4444",
  unknown: "#6b7280",
};

function MetricRow({
  label,
  value,
  icon: Icon,
  suffix,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-sm font-medium">
        {value}
        {suffix && <span className="text-muted-foreground ml-0.5">{suffix}</span>}
      </span>
    </div>
  );
}

export function NetworkHealthCard() {
  const [data, setData] = useState<NetworkHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile/network-health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((res) => {
        setData(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network Health</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to load network health: {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totalContacts === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network Health</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Import contacts to see network health metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Coverage pie data
  const coverageData = [
    { name: "Addressed", value: data.addressedContacts },
    {
      name: "Unaddressed",
      value: data.totalContacts - data.addressedContacts,
    },
  ];
  const coverageColors = ["#22c55e", "#e5e7eb"];

  // Tier bar data
  const tierData = Object.entries(data.tierDistribution)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => ({
      tier: tier.charAt(0).toUpperCase() + tier.slice(1),
      count,
      fill: TIER_COLORS[tier] || TIER_COLORS.unscored,
    }));

  // Relationship data
  const relData = Object.entries(data.relationshipDistribution)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status: status.charAt(0).toUpperCase() + status.slice(1),
      count,
      fill: RELATIONSHIP_COLORS[status] || RELATIONSHIP_COLORS.unknown,
    }));

  const addressedPctDisplay = Math.round(data.addressedPct * 100);
  const completenessPctDisplay = Math.round(data.avgCompleteness * 100);
  const embeddingPctDisplay = Math.round(data.embeddingPct * 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Network Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold">{data.totalContacts.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total Contacts</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{addressedPctDisplay}%</p>
            <p className="text-xs text-muted-foreground">ICP Coverage</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{data.avgCompositeScore.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg Score</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{embeddingPctDisplay}%</p>
            <p className="text-xs text-muted-foreground">Embedded</p>
          </div>
        </div>

        {/* Coverage + Tier side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Coverage Pie */}
          <div>
            <p className="text-sm font-medium mb-2">ICP Coverage</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={coverageData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={60}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {coverageData.map((entry, i) => (
                    <Cell key={entry.name} fill={coverageColors[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                <Legend
                  verticalAlign="bottom"
                  height={24}
                  formatter={(value: string) => (
                    <span className="text-xs">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Tier Distribution Bar */}
          <div>
            <p className="text-sm font-medium mb-2">Tier Distribution</p>
            {tierData.length === 0 ? (
              <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
                No scored contacts yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={tierData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="tier"
                    type="category"
                    width={70}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {tierData.map((entry) => (
                      <Cell key={entry.tier} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Relationship Health */}
        <div>
          <p className="text-sm font-medium mb-2">Relationship Health</p>
          {relData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No message data available
            </p>
          ) : (
            <div className="flex gap-1 h-6 rounded-md overflow-hidden">
              {relData.map((seg) => {
                const pct = (seg.count / data.totalContacts) * 100;
                if (pct < 0.5) return null;
                return (
                  <div
                    key={seg.status}
                    className="relative group"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: seg.fill,
                      minWidth: pct > 0 ? "4px" : undefined,
                    }}
                    title={`${seg.status}: ${seg.count}`}
                  />
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            {relData.map((seg) => (
              <span key={seg.status} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: seg.fill }}
                />
                {seg.status} ({seg.count})
              </span>
            ))}
          </div>
        </div>

        {/* Data Quality */}
        <div>
          <p className="text-sm font-medium mb-2">Data Completeness</p>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Overall</span>
                <span className="font-medium">{completenessPctDisplay}%</span>
              </div>
              <Progress value={completenessPctDisplay} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1">
                {data.missingEmailCount > 0 ? (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                ) : (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                )}
                <span className="text-muted-foreground">
                  {data.missingEmailCount > 0
                    ? `${data.missingEmailCount} missing email`
                    : "All emails"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {data.missingTitleCount > 0 ? (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                ) : (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                )}
                <span className="text-muted-foreground">
                  {data.missingTitleCount > 0
                    ? `${data.missingTitleCount} missing title`
                    : "All titles"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {data.missingCompanyCount > 0 ? (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                ) : (
                  <CheckCircle className="h-3 w-3 text-green-500" />
                )}
                <span className="text-muted-foreground">
                  {data.missingCompanyCount > 0
                    ? `${data.missingCompanyCount} missing company`
                    : "All companies"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Embedding + Activity */}
        <div className="space-y-1 border-t pt-3">
          <MetricRow
            label="Embeddings"
            value={`${data.embeddingCount.toLocaleString()} / ${data.totalContacts.toLocaleString()}`}
            icon={Database}
            suffix={` (${embeddingPctDisplay}%)`}
          />
          {data.embeddingPct < 1 && (
            <p className="text-xs text-muted-foreground ml-6">
              <a href="/admin" className="text-primary hover:underline">
                Admin &rarr; Reindex
              </a>{" "}
              to generate missing embeddings
            </p>
          )}
          <MetricRow
            label="Recent Connections"
            value={data.recentConnections}
            icon={Users}
            suffix=" (30d)"
          />
          <MetricRow
            label="Active Goals"
            value={data.activeGoals}
            icon={Target}
          />
          <MetricRow
            label="Pending Tasks"
            value={data.pendingTasks}
            icon={Activity}
          />
        </div>

        {/* Computed timestamp */}
        <p className="text-xs text-muted-foreground text-right">
          Computed {new Date(data.computedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
