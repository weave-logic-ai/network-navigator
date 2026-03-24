"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrors knowledge-local.ts)
// ---------------------------------------------------------------------------

type EntityType = "ROLE" | "SKILL" | "INDUSTRY" | "TECHNOLOGY" | "COMPANY";

interface KnowledgeEntity {
  id: string;
  label: string;
  type: EntityType;
  frequency: number;
  contactIds: string[];
}

interface CoOccurrenceEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

interface KnowledgeCluster {
  id: string;
  label: string;
  entityIds: string[];
  type: EntityType;
}

interface KnowledgeGraph {
  nodes: KnowledgeEntity[];
  edges: CoOccurrenceEdge[];
  clusters: KnowledgeCluster[];
}

interface NicheOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Color scheme
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<EntityType, string> = {
  ROLE: "#3B82F6",       // blue
  SKILL: "#22C55E",      // green
  INDUSTRY: "#F97316",   // orange
  TECHNOLOGY: "#A855F7", // purple
  COMPANY: "#6B7280",    // gray
};

const TYPE_LABELS: Record<EntityType, string> = {
  ROLE: "Roles",
  SKILL: "Skills",
  INDUSTRY: "Industries",
  TECHNOLOGY: "Technologies",
  COMPANY: "Companies",
};

// ---------------------------------------------------------------------------
// Simple force-directed layout (SVG)
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  label: string;
  type: EntityType;
  frequency: number;
  contactIds: string[];
}

function runForceLayout(
  nodes: LayoutNode[],
  edges: CoOccurrenceEdge[],
  width: number,
  height: number,
  iterations: number = 80
): void {
  const edgeIndex = new Map<string, string[]>();
  for (const e of edges) {
    if (!edgeIndex.has(e.source)) edgeIndex.set(e.source, []);
    if (!edgeIndex.has(e.target)) edgeIndex.set(e.target, []);
    edgeIndex.get(e.source)!.push(e.target);
    edgeIndex.get(e.target)!.push(e.source);
  }

  const nodeMap = new Map<string, LayoutNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const cx = width / 2;
  const cy = height / 2;

  // Initialize with random positions in a circle
  for (const n of nodes) {
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.random() * Math.min(width, height) * 0.35;
    n.x = cx + Math.cos(angle) * radius;
    n.y = cy + Math.sin(angle) * radius;
    n.vx = 0;
    n.vy = 0;
  }

  const idealDist = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.8;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const repulsionStrength = idealDist * idealDist * 0.5;

    // Repulsion between all pairs (cap at N=200 for performance)
    for (let i = 0; i < nodes.length && i < 200; i++) {
      for (let j = i + 1; j < nodes.length && j < 200; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (repulsionStrength / (dist * dist)) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist / idealDist) * alpha * 0.3;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Gravity toward center
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.005 * alpha;
      n.vy += (cy - n.y) * 0.005 * alpha;
    }

    // Apply velocities with damping
    for (const n of nodes) {
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      // Keep within bounds
      n.x = Math.max(30, Math.min(width - 30, n.x));
      n.y = Math.max(30, Math.min(height - 30, n.y));
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KnowledgeGraphProps {
  nicheId?: string;
}

export function KnowledgeGraphView({ nicheId: propNicheId }: KnowledgeGraphProps) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);
  const [niches, setNiches] = useState<NicheOption[]>([]);
  const [selectedNiche, setSelectedNiche] = useState<string>(propNicheId || "all");
  const [filterType, setFilterType] = useState<EntityType | "ALL">("ALL");
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch niches for the dropdown
  useEffect(() => {
    async function fetchNiches() {
      try {
        const res = await fetch("/api/niches");
        if (res.ok) {
          const json = await res.json();
          setNiches((json.data || []).map((n: { id: string; name: string }) => ({
            id: n.id,
            name: n.name,
          })));
        }
      } catch {
        // Non-fatal
      }
    }
    fetchNiches();
  }, []);

  const fetchGraph = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      setSelectedEntity(null);
      try {
        const params = new URLSearchParams();
        if (selectedNiche && selectedNiche !== "all") {
          params.set("nicheId", selectedNiche);
        }
        if (refresh) params.set("refresh", "true");
        const res = await fetch(`/api/graph/knowledge?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch knowledge graph");
        const json = await res.json();
        setGraph(json.data);
        setCached(json.cached ?? false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [selectedNiche]
  );

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Layout computation
  const { layoutNodes, layoutEdges, svgWidth, svgHeight } = useMemo(() => {
    if (!graph || graph.nodes.length === 0) {
      return { layoutNodes: [], layoutEdges: [], svgWidth: 800, svgHeight: 600 };
    }

    const w = 800;
    const h = 600;

    // Filter nodes by type if needed
    const filteredNodeSet = new Set<string>();
    const filteredNodes = graph.nodes.filter((n) => {
      if (filterType === "ALL") return true;
      return n.type === filterType;
    });
    for (const n of filteredNodes) filteredNodeSet.add(n.id);

    // Cap at 150 nodes for performance
    const cappedNodes = filteredNodes.slice(0, 150);
    const cappedSet = new Set(cappedNodes.map((n) => n.id));

    const lnodes: LayoutNode[] = cappedNodes.map((n) => ({
      id: n.id,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      label: n.label,
      type: n.type,
      frequency: n.frequency,
      contactIds: n.contactIds,
    }));

    const ledges = graph.edges.filter(
      (e) => cappedSet.has(e.source) && cappedSet.has(e.target)
    );

    runForceLayout(lnodes, ledges, w, h);

    return { layoutNodes: lnodes, layoutEdges: ledges, svgWidth: w, svgHeight: h };
  }, [graph, filterType]);

  // Compute node positions lookup for edges
  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of layoutNodes) {
      map.set(n.id, { x: n.x, y: n.y });
    }
    return map;
  }, [layoutNodes]);

  // Max weight for edge thickness normalization
  const maxWeight = useMemo(() => {
    if (layoutEdges.length === 0) return 1;
    return Math.max(...layoutEdges.map((e) => e.weight));
  }, [layoutEdges]);

  // Max frequency for node size normalization
  const maxFreq = useMemo(() => {
    if (layoutNodes.length === 0) return 1;
    return Math.max(...layoutNodes.map((n) => n.frequency));
  }, [layoutNodes]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-[500px] w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center text-destructive">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center text-muted-foreground">
        <p>No knowledge graph data. Import contacts and try again.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Main graph area */}
      <div className="flex-1 flex flex-col gap-3">
        {/* Controls bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedNiche} onValueChange={setSelectedNiche}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="All contacts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contacts</SelectItem>
              {niches.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filterType}
            onValueChange={(v) => setFilterType(v as EntityType | "ALL")}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="ROLE">Roles</SelectItem>
              <SelectItem value="SKILL">Skills</SelectItem>
              <SelectItem value="INDUSTRY">Industries</SelectItem>
              <SelectItem value="TECHNOLOGY">Technologies</SelectItem>
              <SelectItem value="COMPANY">Companies</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => fetchGraph(true)}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh
          </Button>

          {cached && (
            <Badge variant="secondary" className="text-[10px]">
              cached
            </Badge>
          )}

          <span className="text-xs text-muted-foreground ml-auto">
            {graph.nodes.length} entities &middot; {graph.edges.length} edges
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap">
          {(Object.entries(TYPE_COLORS) as [EntityType, string][]).map(
            ([type, color]) => (
              <div key={type} className="flex items-center gap-1">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {TYPE_LABELS[type]}
                </span>
              </div>
            )
          )}
        </div>

        {/* SVG graph */}
        <div className="relative flex-1 rounded-lg border bg-background overflow-hidden min-h-[400px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full"
            style={{ minHeight: 400 }}
          >
            {/* Edges */}
            {layoutEdges.map((edge) => {
              const s = nodePositions.get(edge.source);
              const t = nodePositions.get(edge.target);
              if (!s || !t) return null;
              const thickness = 0.5 + (edge.weight / maxWeight) * 3;
              return (
                <line
                  key={edge.id}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="#94A3B8"
                  strokeWidth={thickness}
                  strokeOpacity={0.25 + (edge.weight / maxWeight) * 0.35}
                />
              );
            })}

            {/* Nodes */}
            {layoutNodes.map((node) => {
              const radius = 4 + (node.frequency / maxFreq) * 14;
              const isSelected = selectedEntity?.id === node.id;
              return (
                <g key={node.id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={TYPE_COLORS[node.type]}
                    fillOpacity={isSelected ? 1 : 0.75}
                    stroke={isSelected ? "#fff" : "transparent"}
                    strokeWidth={isSelected ? 2 : 0}
                    className="cursor-pointer transition-opacity hover:fill-opacity-100"
                    onClick={() =>
                      setSelectedEntity(
                        isSelected
                          ? null
                          : {
                              id: node.id,
                              label: node.label,
                              type: node.type,
                              frequency: node.frequency,
                              contactIds: node.contactIds,
                            }
                      )
                    }
                  />
                  {/* Label for large or selected nodes */}
                  {(radius > 8 || isSelected) && (
                    <text
                      x={node.x}
                      y={node.y - radius - 3}
                      textAnchor="middle"
                      fontSize={isSelected ? 11 : 9}
                      fill="currentColor"
                      className="pointer-events-none select-none"
                      fontWeight={isSelected ? 600 : 400}
                    >
                      {node.label.length > 20
                        ? node.label.slice(0, 18) + "..."
                        : node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Right sidebar: entity details */}
      <Card className="w-60 shrink-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {selectedEntity ? "Entity Details" : "Top Entities"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {selectedEntity ? (
            <div className="px-4 pb-4 space-y-3">
              <div>
                <p className="text-sm font-semibold">{selectedEntity.label}</p>
                <Badge
                  className="text-[10px] mt-1"
                  style={{
                    backgroundColor: TYPE_COLORS[selectedEntity.type],
                    color: "#fff",
                  }}
                >
                  {selectedEntity.type}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Appears in {selectedEntity.frequency} contact
                {selectedEntity.frequency !== 1 ? "s" : ""}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => setSelectedEntity(null)}
              >
                Clear selection
              </Button>
              <div className="text-xs font-medium mt-2">Contact IDs</div>
              <ScrollArea className="h-48">
                <div className="space-y-1 pr-2">
                  {selectedEntity.contactIds.slice(0, 30).map((cid) => (
                    <a
                      key={cid}
                      href={`/contacts/${cid}`}
                      className="block text-[10px] text-primary hover:underline truncate"
                    >
                      {cid}
                    </a>
                  ))}
                  {selectedEntity.contactIds.length > 30 && (
                    <p className="text-[10px] text-muted-foreground">
                      +{selectedEntity.contactIds.length - 30} more
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <ScrollArea className="h-[450px]">
              <div className="px-4 pb-4 space-y-1.5">
                {graph.nodes.slice(0, 40).map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => setSelectedEntity(entity)}
                    className="w-full flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent/50 transition-colors"
                  >
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: TYPE_COLORS[entity.type] }}
                    />
                    <span className="text-xs truncate flex-1">
                      {entity.label}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] shrink-0"
                    >
                      {entity.frequency}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
