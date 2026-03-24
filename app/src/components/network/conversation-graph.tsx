"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

// --- Types ---

interface ConversationNode {
  id: string;
  label: string;
  messageCount: number;
}

interface ConversationEdge {
  id: string;
  source: string;
  target: string;
  messageCount: number;
  weight: number;
  lastActivity: string | null;
}

interface PositionedNode extends ConversationNode {
  x: number;
  y: number;
  radius: number;
}

// --- Force simulation (simple spring-based for small graphs) ---

function runForceLayout(
  nodes: ConversationNode[],
  edges: ConversationEdge[],
  width: number,
  height: number
): PositionedNode[] {
  if (nodes.length === 0) return [];

  // Compute radius by message count
  const maxMsg = Math.max(...nodes.map((n) => n.messageCount), 1);
  const minRadius = 4;
  const maxRadius = 20;

  // Initialize positions randomly around center
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.min(width, height) * 0.35;

  const positioned: PositionedNode[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = spread * (0.3 + Math.random() * 0.7);
    return {
      ...n,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      radius:
        minRadius +
        ((n.messageCount / maxMsg) * (maxRadius - minRadius)),
    };
  });

  // Build adjacency lookup
  const nodeIndex = new Map<string, number>();
  positioned.forEach((n, i) => nodeIndex.set(n.id, i));

  // Simple force-directed iterations
  const iterations = 150;
  const repulsion = 3000;
  const attraction = 0.005;
  const damping = 0.92;

  const vx = new Float64Array(positioned.length);
  const vy = new Float64Array(positioned.length);

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const dx = positioned[i].x - positioned[j].x;
        const dy = positioned[i].y - positioned[j].y;
        const dist2 = dx * dx + dy * dy + 1;
        const force = repulsion / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vx[i] += fx;
        vy[i] += fy;
        vx[j] -= fx;
        vy[j] -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const si = nodeIndex.get(edge.source);
      const ti = nodeIndex.get(edge.target);
      if (si === undefined || ti === undefined) continue;
      const dx = positioned[ti].x - positioned[si].x;
      const dy = positioned[ti].y - positioned[si].y;
      const fx = dx * attraction;
      const fy = dy * attraction;
      vx[si] += fx;
      vy[si] += fy;
      vx[ti] -= fx;
      vy[ti] -= fy;
    }

    // Center gravity
    for (let i = 0; i < positioned.length; i++) {
      vx[i] += (cx - positioned[i].x) * 0.001;
      vy[i] += (cy - positioned[i].y) * 0.001;
    }

    // Apply velocities with damping
    for (let i = 0; i < positioned.length; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      positioned[i].x += vx[i];
      positioned[i].y += vy[i];
      // Clamp to bounds
      const pad = positioned[i].radius + 2;
      positioned[i].x = Math.max(pad, Math.min(width - pad, positioned[i].x));
      positioned[i].y = Math.max(pad, Math.min(height - pad, positioned[i].y));
    }
  }

  return positioned;
}

// --- Edge color by recency ---

function getEdgeColor(lastActivity: string | null): string {
  if (!lastActivity) return "#6B7280";
  const now = Date.now();
  const activityTime = new Date(lastActivity).getTime();
  const daysSince = (now - activityTime) / (1000 * 60 * 60 * 24);

  if (daysSince < 30) return "#22C55E"; // green - recent
  if (daysSince < 90) return "#84CC16"; // lime
  if (daysSince < 180) return "#F59E0B"; // amber
  if (daysSince < 365) return "#F97316"; // orange
  return "#EF4444"; // red - old
}

function getEdgeOpacity(messageCount: number, maxMessages: number): number {
  if (maxMessages === 0) return 0.3;
  return 0.2 + (messageCount / maxMessages) * 0.6;
}

// --- Main Component ---

export function ConversationGraph() {
  const [nodes, setNodes] = useState<ConversationNode[]>([]);
  const [edges, setEdges] = useState<ConversationEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: PositionedNode;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/graph/conversations");
        if (!res.ok) throw new Error("Failed to fetch conversation data");
        const json = await res.json();
        if (!cancelled) {
          setNodes(json.data?.nodes ?? []);
          setEdges(json.data?.edges ?? []);
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

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Run force layout
  const positionedNodes = useMemo(
    () => runForceLayout(nodes, edges, dimensions.width, dimensions.height),
    [nodes, edges, dimensions.width, dimensions.height]
  );

  const nodePositionMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of positionedNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [positionedNodes]);

  const maxMessages = useMemo(
    () => Math.max(...edges.map((e) => e.messageCount), 1),
    [edges]
  );

  const handleNodeHover = useCallback(
    (nodeId: string | null, event?: React.MouseEvent) => {
      setHoveredNode(nodeId);
      if (nodeId && event) {
        const node = nodePositionMap.get(nodeId);
        if (node) {
          setTooltip({ x: event.clientX, y: event.clientY, node });
        }
      } else {
        setTooltip(null);
      }
    },
    [nodePositionMap]
  );

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

  if (nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <p>No conversation data available. Import messages to see the graph.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Edge recency:</span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded" style={{ background: "#22C55E" }} />
            <span className="text-[10px]">&lt;30d</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded" style={{ background: "#F59E0B" }} />
            <span className="text-[10px]">3-6mo</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded" style={{ background: "#EF4444" }} />
            <span className="text-[10px]">&gt;1yr</span>
          </span>
        </div>
        <Badge variant="secondary" className="text-[10px] ml-auto">
          {nodes.length} contacts &middot; {edges.length} conversations
        </Badge>
      </div>

      {/* SVG Canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="absolute inset-0"
        >
          {/* Edges */}
          {edges.map((edge) => {
            const source = nodePositionMap.get(edge.source);
            const target = nodePositionMap.get(edge.target);
            if (!source || !target) return null;

            const isHighlighted =
              hoveredNode === edge.source || hoveredNode === edge.target;

            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={getEdgeColor(edge.lastActivity)}
                strokeWidth={
                  isHighlighted
                    ? Math.max(2, edge.messageCount / maxMessages * 4)
                    : Math.max(0.5, edge.messageCount / maxMessages * 3)
                }
                strokeOpacity={
                  hoveredNode
                    ? isHighlighted
                      ? 0.9
                      : 0.1
                    : getEdgeOpacity(edge.messageCount, maxMessages)
                }
              />
            );
          })}

          {/* Nodes */}
          {positionedNodes.map((node) => {
            const isHovered = hoveredNode === node.id;
            const isConnected = hoveredNode
              ? edges.some(
                  (e) =>
                    (e.source === hoveredNode && e.target === node.id) ||
                    (e.target === hoveredNode && e.source === node.id)
                )
              : false;
            const dimmed = hoveredNode !== null && !isHovered && !isConnected;

            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isHovered ? node.radius + 2 : node.radius}
                  fill={isHovered ? "#3B82F6" : "#6366F1"}
                  fillOpacity={dimmed ? 0.15 : 0.85}
                  stroke={isHovered ? "#1D4ED8" : "transparent"}
                  strokeWidth={isHovered ? 2 : 0}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={(e) => handleNodeHover(node.id, e)}
                  onMouseLeave={() => handleNodeHover(null)}
                />
                {/* Label for larger nodes */}
                {node.radius > 8 && !dimmed && (
                  <text
                    x={node.x}
                    y={node.y + node.radius + 12}
                    textAnchor="middle"
                    fill="currentColor"
                    fontSize={10}
                    className="pointer-events-none"
                    opacity={0.7}
                  >
                    {node.label.length > 15
                      ? node.label.slice(0, 15) + "..."
                      : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 rounded-md border bg-popover px-3 py-2 text-xs shadow-md pointer-events-none"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 8,
            }}
          >
            <p className="font-medium">{tooltip.node.label}</p>
            <p className="text-muted-foreground">
              {tooltip.node.messageCount} message
              {tooltip.node.messageCount !== 1 ? "s" : ""} exchanged
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
