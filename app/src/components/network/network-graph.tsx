"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type {
  GraphNode,
  GraphEdge,
  GraphCanvasRef,
  InternalGraphNode,
} from "reagraph";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

const GraphCanvas = dynamic(
  () => import("reagraph").then((mod) => mod.GraphCanvas),
  { ssr: false, loading: () => <GraphLoading /> }
);

function GraphLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30 rounded-lg">
      <div className="space-y-3 text-center">
        <Skeleton className="mx-auto h-6 w-48" />
        <Skeleton className="mx-auto h-4 w-32" />
      </div>
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  gold: "#EAB308",
  silver: "#94A3B8",
  bronze: "#D97706",
  watch: "#6B7280",
};

const DEFAULT_NODE_COLOR = "#6B7280";

export type LayoutMode = "forceDirected2d" | "circular2d" | "treeTd2d";
export type ColorByMode = "tier" | "company" | "persona";
export type SizeByMode = "score" | "connections" | "uniform";
export type EdgeFilterMode = "all" | "connections" | "messages";

interface ApiNode {
  id: string;
  label: string;
  tier: string;
  composite_score: number;
  company?: string;
  persona?: string;
  cluster_id?: string;
}

interface ApiEdge {
  id: string;
  source: string;
  target: string;
  edge_type: string;
  weight?: number;
}

interface NetworkGraphProps {
  layout: LayoutMode;
  colorBy: ColorByMode;
  sizeBy: SizeByMode;
  edgeFilter: EdgeFilterMode;
  showClusters: boolean;
  highlightedCluster: string | null;
  refreshKey: number;
}

function getCompanyColor(company: string): string {
  let hash = 0;
  for (let i = 0; i < company.length; i++) {
    hash = company.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function getPersonaColor(persona: string): string {
  const personas: Record<string, string> = {
    champion: "#22C55E",
    decision_maker: "#3B82F6",
    influencer: "#A855F7",
    end_user: "#F59E0B",
    blocker: "#EF4444",
    evaluator: "#06B6D4",
  };
  return personas[persona] || DEFAULT_NODE_COLOR;
}

function normalizeSize(
  score: number,
  min: number,
  max: number,
  outMin: number,
  outMax: number
): number {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((score - min) / (max - min)) * (outMax - outMin);
}

export function NetworkGraph({
  layout,
  colorBy,
  sizeBy,
  edgeFilter,
  showClusters,
  highlightedCluster,
  refreshKey,
}: NetworkGraphProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawNodes, setRawNodes] = useState<ApiNode[]>([]);
  const [rawEdges, setRawEdges] = useState<ApiEdge[]>([]);
  const graphRef = useRef<GraphCanvasRef | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/graph/data?limit=300");
        if (!res.ok) throw new Error("Failed to fetch graph data");
        const json = await res.json();
        if (!cancelled) {
          const gd = json.data || json;
          // API returns { id, label, data: { tier, company, score } } — flatten for local use
          const apiNodes = (gd.nodes || []).map((n: Record<string, unknown>) => {
            const nd = (n.data || {}) as Record<string, unknown>;
            return {
              id: n.id,
              label: n.label,
              tier: nd.tier || null,
              company: nd.company || null,
              composite_score: nd.score || 0,
              persona: nd.persona || null,
              cluster_id: nd.cluster_id || null,
            };
          });
          const apiEdges = (gd.edges || []).map((e: Record<string, unknown>) => {
            const ed = (e.data || {}) as Record<string, unknown>;
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              edge_type: ed.type || 'connection',
              weight: ed.weight || 1,
            };
          });
          setRawNodes(apiNodes);
          setRawEdges(apiEdges);
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
  }, [refreshKey]);

  useEffect(() => {
    if (rawNodes.length === 0) return;

    const scores = rawNodes.map((n) => n.composite_score || 0);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    const connectionCounts = new Map<string, number>();
    for (const edge of rawEdges) {
      connectionCounts.set(
        edge.source,
        (connectionCounts.get(edge.source) || 0) + 1
      );
      connectionCounts.set(
        edge.target,
        (connectionCounts.get(edge.target) || 0) + 1
      );
    }
    const connValues = Array.from(connectionCounts.values());
    const minConn = connValues.length > 0 ? Math.min(...connValues) : 0;
    const maxConn = connValues.length > 0 ? Math.max(...connValues) : 1;

    const mappedNodes: GraphNode[] = rawNodes
      .filter((n) => {
        if (!highlightedCluster) return true;
        return n.cluster_id === highlightedCluster;
      })
      .map((n) => {
        let fill: string;
        switch (colorBy) {
          case "company":
            fill = n.company ? getCompanyColor(n.company) : DEFAULT_NODE_COLOR;
            break;
          case "persona":
            fill = n.persona
              ? getPersonaColor(n.persona)
              : DEFAULT_NODE_COLOR;
            break;
          default:
            fill = TIER_COLORS[n.tier] || DEFAULT_NODE_COLOR;
        }

        let size: number;
        switch (sizeBy) {
          case "connections":
            size = normalizeSize(
              connectionCounts.get(n.id) || 0,
              minConn,
              maxConn,
              5,
              20
            );
            break;
          case "uniform":
            size = 10;
            break;
          default:
            size = normalizeSize(n.composite_score || 0, minScore, maxScore, 5, 20);
        }

        return {
          id: n.id,
          label: n.label,
          fill,
          size,
          data: {
            company: n.company,
            tier: n.tier,
            persona: n.persona,
            score: n.composite_score,
          },
          ...(showClusters && n.cluster_id ? { cluster: n.cluster_id } : {}),
        };
      });

    const nodeIds = new Set(mappedNodes.map((n) => n.id));

    const mappedEdges: GraphEdge[] = rawEdges
      .filter((e) => {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
        switch (edgeFilter) {
          case "connections":
            return e.edge_type === "CONNECTED_TO" || e.edge_type === "connection";
          case "messages":
            return e.edge_type === "MESSAGED" || e.edge_type === "message";
          default:
            return true;
        }
      })
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.edge_type,
        size: e.weight ? Math.max(1, e.weight) : 1,
      }));

    setNodes(mappedNodes);
    setEdges(mappedEdges);
  }, [rawNodes, rawEdges, colorBy, sizeBy, edgeFilter, showClusters, highlightedCluster]);

  const handleNodeClick = useCallback(
    (node: InternalGraphNode) => {
      router.push(`/contacts/${node.id}`);
    },
    [router]
  );

  if (loading) {
    return <GraphLoading />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-destructive">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <p>No graph data available. Click &quot;Compute Graph&quot; to generate.</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <GraphCanvas
        ref={graphRef}
        nodes={nodes}
        edges={edges}
        layoutType={layout}
        labelType="auto"
        sizingType="attribute"
        sizingAttribute="size"
        edgeArrowPosition="end"
        edgeInterpolation="curved"
        onNodeClick={handleNodeClick}
        animated
      />
    </div>
  );
}
