"use client";

import { useEffect, useState, useCallback } from "react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import type { TreemapNode } from "recharts/types/chart/Treemap";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

// --- Types ---

interface TaxonomyIcp {
  id: string;
  name: string;
  type: "icp";
  matchCount: number;
}

interface TaxonomyNiche {
  id: string;
  name: string;
  type: "niche";
  contactCount: number;
  keywords: string[];
  children: TaxonomyIcp[];
}

interface TaxonomyIndustry {
  id: string;
  name: string;
  type: "industry";
  children: TaxonomyNiche[];
}

// Treemap needs size + name at each leaf; index signature required by recharts
interface TreemapItem {
  [key: string]: unknown;
  name: string;
  size: number;
  id: string;
  nodeType: "industry" | "niche" | "icp";
  fill?: string;
  children?: TreemapItem[];
}

// --- Industry colors ---

const INDUSTRY_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#F97316", "#EC4899", "#14B8A6", "#6366F1",
  "#84CC16", "#D946EF", "#0EA5E9", "#F43F5E", "#A3E635",
];

function getIndustryColor(index: number): string {
  return INDUSTRY_COLORS[index % INDUSTRY_COLORS.length];
}

// --- Custom Treemap content renderer ---

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fill?: string;
  depth?: number;
  nodeType?: string;
  size?: number;
}

function CustomTreemapContent(props: TreemapContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, fill, depth } = props;

  if (width < 4 || height < 4) return null;

  const showLabel = width > 40 && height > 20;
  const fontSize = Math.min(12, Math.max(8, Math.min(width, height) / 5));

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill || "#6B7280"}
        fillOpacity={depth === 1 ? 0.9 : depth === 2 ? 0.7 : 0.5}
        stroke="#fff"
        strokeWidth={depth === 1 ? 2 : 1}
        rx={2}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={fontSize}
          fontWeight={depth === 1 ? 600 : 400}
        >
          {(name ?? "").length > Math.floor(width / (fontSize * 0.6))
            ? (name ?? "").slice(0, Math.floor(width / (fontSize * 0.6))) + "..."
            : name}
        </text>
      )}
    </g>
  );
}

// --- Tooltip ---

interface TooltipPayloadItem {
  payload?: {
    name?: string;
    nodeType?: string;
    size?: number;
  };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  const typeLabel =
    data.nodeType === "industry"
      ? "Industry"
      : data.nodeType === "niche"
        ? "Niche"
        : "ICP";

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{data.name}</p>
      <p className="text-muted-foreground">
        {typeLabel} &middot; {data.size ?? 0} contact{(data.size ?? 0) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// --- Main Component ---

export function TaxonomyGraph() {
  const [data, setData] = useState<TaxonomyIndustry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<
    { id: string; name: string; type: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/graph/taxonomy");
        if (!res.ok) throw new Error("Failed to fetch taxonomy data");
        const json = await res.json();
        if (!cancelled) {
          setData(json.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDrillDown = useCallback(
    (nodeId: string, nodeName: string, nodeType: string) => {
      setDrillPath((prev) => [...prev, { id: nodeId, name: nodeName, type: nodeType }]);
    },
    []
  );

  const handleDrillUp = useCallback(() => {
    setDrillPath((prev) => prev.slice(0, -1));
  }, []);

  const handleDrillReset = useCallback(() => {
    setDrillPath([]);
  }, []);

  // Build treemap data based on current drill path
  const treemapData = buildTreemapData(data, drillPath);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/30 rounded-lg">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-6 w-48" />
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-destructive">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <p>No taxonomy data available. Create verticals and niches to see the hierarchy.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        {drillPath.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleDrillUp}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        )}
        <button
          type="button"
          onClick={handleDrillReset}
          className="text-xs font-medium hover:underline"
        >
          All Industries
        </button>
        {drillPath.map((segment, i) => (
          <span key={segment.id} className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">/</span>
            <button
              type="button"
              onClick={() => setDrillPath((prev) => prev.slice(0, i + 1))}
              className="text-xs font-medium hover:underline"
            >
              {segment.name}
            </button>
            <Badge variant="outline" className="text-[10px] h-4">
              {segment.type}
            </Badge>
          </span>
        ))}
      </div>

      {/* Treemap */}
      <div className="flex-1 min-h-0">
        {treemapData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            No items at this level.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="#fff"
              content={<CustomTreemapContent />}
              onClick={(node: TreemapNode) => {
                const nodeType = node?.nodeType as string | undefined;
                const nodeId = node?.id as string | undefined;
                if (nodeType && nodeType !== "icp" && nodeId) {
                  handleDrillDown(nodeId, node.name, nodeType);
                }
              }}
              isAnimationActive={false}
            >
              <Tooltip content={<CustomTooltip />} />
            </Treemap>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// --- Data transformation ---

function buildTreemapData(
  data: TaxonomyIndustry[],
  drillPath: { id: string; name: string; type: string }[]
): TreemapItem[] {
  if (drillPath.length === 0) {
    // Top level: industries
    return data.map((industry, idx) => {
      const totalContacts = industry.children.reduce(
        (sum, n) => sum + (n.contactCount || 1),
        0
      );
      return {
        name: industry.name,
        size: Math.max(totalContacts, 1),
        id: industry.id,
        nodeType: "industry" as const,
        fill: getIndustryColor(idx),
      };
    });
  }

  if (drillPath.length === 1) {
    // Drilled into an industry: show niches
    const industry = data.find((d) => d.id === drillPath[0].id);
    if (!industry) return [];
    const industryIdx = data.indexOf(industry);
    const baseColor = getIndustryColor(industryIdx);

    return industry.children.map((niche) => ({
      name: niche.name,
      size: Math.max(niche.contactCount, 1),
      id: niche.id,
      nodeType: "niche" as const,
      fill: baseColor,
    }));
  }

  if (drillPath.length >= 2) {
    // Drilled into a niche: show ICPs
    const industry = data.find((d) => d.id === drillPath[0].id);
    if (!industry) return [];
    const niche = industry.children.find((n) => n.id === drillPath[1].id);
    if (!niche) return [];
    const industryIdx = data.indexOf(industry);
    const baseColor = getIndustryColor(industryIdx);

    return niche.children.map((icp) => ({
      name: icp.name,
      size: Math.max(icp.matchCount, 1),
      id: icp.id,
      nodeType: "icp" as const,
      fill: baseColor,
    }));
  }

  return [];
}
