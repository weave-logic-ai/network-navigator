"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { isShiftClick, setSecondaryTargetViaShiftClick } from "./shift-click";
import { contextController } from "@/lib/targets/context-controller";

interface SigmaNode {
  key: string;
  attributes: {
    label: string;
    x: number;
    y: number;
    size: number;
    color: string;
    tier: string;
    company: string | null;
    title: string | null;
    pagerank: number;
    score: number;
    degree: number;
    clusterId: string | null;
    kind?: "contact" | "company";
  };
}

interface SigmaEdge {
  key: string;
  source: string;
  target: string;
  attributes: {
    type: string;
    weight: number;
  };
}

interface GraphData {
  nodes: SigmaNode[];
  edges: SigmaEdge[];
  focusNodeId: string | null;
  stats: {
    totalNodes: number;
    loadedNodes: number;
    availableNodes: number;
    truncatedNodes: number;
    totalEdges: number;
    availableEdges: number;
    truncatedEdges: number;
    communities: number;
  };
}

export function formatGraphCounts(stats: GraphData["stats"]): string {
  const truncated = [
    stats.truncatedNodes > 0 ? `${stats.truncatedNodes} ${stats.truncatedNodes === 1 ? "node" : "nodes"}` : null,
    stats.truncatedEdges > 0 ? `${stats.truncatedEdges} ${stats.truncatedEdges === 1 ? "edge" : "edges"}` : null,
  ].filter(Boolean);
  return `${stats.loadedNodes}/${stats.availableNodes} nodes, ` +
    `${stats.totalEdges}/${stats.availableEdges} edges` +
    (truncated.length ? ` (${truncated.join(", ")} truncated)` : "");
}

interface SigmaGraphProps {
  nicheId?: string;
  edgeTypes?: string[];
  limit?: number;
  onNodeClick?: (nodeId: string) => void;
  /**
   * Phase 4 Track I — when true, the graph fetches ECC provenance edges
   * (`evidence_for`, `derived_from`) along with the ordinary real edges.
   * Controlled by the "Show provenance edges" toggle below, which persists
   * to the active lens's `config.showProvenanceEdges` field.
   */
  showProvenanceEdges?: boolean;
  onShowProvenanceEdgesChange?: (next: boolean) => void;
  /**
   * ClusterSidebar's "click a cluster to highlight its nodes" feature
   * (Communities button on the Graph tab). When set to a `clusters.id`,
   * nodes whose `clusterId` doesn't match are dimmed the same way a search
   * query dims non-matches — see the node-reducer effect below.
   */
  highlightedCluster?: string | null;
  /**
   * ADR-027 graph re-rooting. A contact or company `research_targets.id`
   * to center the graph on, in place of the default top-by-PageRank
   * listing. Per the ADR, this is normally the current *secondary* target
   * — passed straight through to `/api/graph/sigma-data?primaryTargetId=`,
   * which keeps that wire name for consistency with the (unwired)
   * `/api/graph/data` implementation it was ported from. Mirrors the
   * `showProvenanceEdges`/`onShowProvenanceEdgesChange` controlled-prop
   * pattern above: the parent supplies the confirmed server focus.
   */
  rootTargetId?: string | null;
  onRootTargetIdChange?: (next: string) => void;
}

const EDGE_TYPE_OPTIONS = [
  { value: "CONNECTED_TO", label: "Connected" },
  { value: "MESSAGED", label: "Messaged" },
  { value: "same-company", label: "Same Company" },
  { value: "INVITED_BY", label: "Invited" },
  { value: "ENDORSED", label: "Endorsed" },
  { value: "RECOMMENDED", label: "Recommended" },
  { value: "company-context", label: "Company links" },
];

/** One action from a selected graph node writes only the secondary target. */
export async function focusGraphNode(
  node: Pick<SigmaNode, "key" | "attributes">,
): Promise<{ ok: boolean; secondaryTargetId?: string }> {
  if (node.attributes.kind !== "company") {
    return setSecondaryTargetViaShiftClick(node.key);
  }
  try {
    const snapshot = await contextController.createAndFocus("company", node.key);
    return { ok: true, secondaryTargetId: snapshot.secondaryTargetId ?? undefined };
  } catch {
    return { ok: false };
  }
}

export function SigmaGraph({
  nicheId,
  edgeTypes: initialEdgeTypes,
  limit = 500,
  onNodeClick,
  showProvenanceEdges = false,
  onShowProvenanceEdgesChange,
  highlightedCluster = null,
  rootTargetId = null,
  onRootTargetIdChange,
}: SigmaGraphProps) {
  // Local copy of the toggle: mirrors the parent's value when controlled,
  // otherwise acts as uncontrolled state. Either way, flipping it triggers
  // a refetch (see loadData dep array below) with cache-bust via
  // includeProvenanceEdges=true — matching the Phase 4 §6 behavior.
  const [provenanceOn, setProvenanceOn] = useState<boolean>(showProvenanceEdges);
  // The parent supplies the confirmed server root; failed writes leave it intact.
  const activeRootTargetId = rootTargetId;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigmaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const initializingRef = useRef(false);
  const mountedRef = useRef(true);
  const latestDataRef = useRef<GraphData | null>(null);
  const requestSeqRef = useRef(0);
  const [data, setData] = useState<GraphData | null>(null);
  const [graphRevision, setGraphRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<SigmaNode | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const [edgeTypes, setEdgeTypes] = useState<string[]>(
    initialEdgeTypes || EDGE_TYPE_OPTIONS.map((o) => o.value)
  );
  // WS-4 §3.2 — shift-click amber flash. Node ids in this set are rendered
  // amber for ~600 ms after the user shift-clicks them to set the secondary
  // target. Mutations happen in the clickNode handler; a matching setTimeout
  // drains the set. The node reducer below reads this to override color.
  const [secondarySetFlash, setSecondarySetFlash] = useState<Set<string>>(
    () => new Set()
  );

  const focusSelectedNode = useCallback(async (node: SigmaNode) => {
    setFocusPending(true);
    setFocusError(null);
    const result = await focusGraphNode(node);
    if (!mountedRef.current) return;
    setFocusPending(false);
    if (!result.ok || !result.secondaryTargetId) {
      setFocusError("Could not focus this node. Please try again.");
      return;
    }
    onRootTargetIdChange?.(result.secondaryTargetId);
    setSecondarySetFlash((prev) => new Set(prev).add(node.key));
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      setSecondarySetFlash((prev) => {
        const next = new Set(prev);
        next.delete(node.key);
        return next;
      });
    }, 600);
  }, [onRootTargetIdChange]);
  const focusNodeRef = useRef(focusSelectedNode);
  focusNodeRef.current = focusSelectedNode;

  const loadData = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (nicheId) params.set("nicheId", nicheId);
      params.set("edgeTypes", edgeTypes.join(","));
      if (provenanceOn) params.set("includeProvenanceEdges", "true");
      if (activeRootTargetId) params.set("primaryTargetId", activeRootTargetId);

      const res = await fetch(`/api/graph/sigma-data?${params}`);
      if (!res.ok) throw new Error("Failed to load graph data");
      const json = await res.json();
      if (requestSeq === requestSeqRef.current) setData(json.data);
    } catch (err) {
      if (requestSeq === requestSeqRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      if (requestSeq === requestSeqRef.current) setLoading(false);
    }
  }, [limit, nicheId, edgeTypes, provenanceOn, activeRootTargetId]);

  const handleProvenanceToggle = useCallback(() => {
    setProvenanceOn((prev) => {
      const next = !prev;
      onShowProvenanceEdgesChange?.(next);
      return next;
    });
  }, [onShowProvenanceEdgesChange]);

  // Sync with parent-controlled prop if the caller updates it.
  useEffect(() => {
    setProvenanceOn(showProvenanceEdges);
  }, [showProvenanceEdges]);

  // Clear local selection when the confirmed root changes.
  useEffect(() => {
    setSearchQuery("");
    setSelectedNode(null);
  }, [rootTargetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  // Preserve positions and the WebGL renderer when a target changes. The
  // initial ForceAtlas2 pass is expensive at 1,000+ nodes; running it again
  // for the same graph made an ordinary target switch exceed the 200 ms
  // client-observed re-center budget.
  const applyDataToGraph = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any,
    nextData: GraphData,
  ) => {
    const nodeKeys = new Set(nextData.nodes.map((node) => node.key));
    const removedNodes: string[] = [];
    graph.forEachNode((key: string) => {
      if (!nodeKeys.has(key)) removedNodes.push(key);
    });
    for (const key of removedNodes) graph.dropNode(key);

    for (const node of nextData.nodes) {
      if (graph.hasNode(node.key)) {
        const { x, y } = graph.getNodeAttributes(node.key);
        graph.mergeNodeAttributes(node.key, { ...node.attributes, x, y });
      } else {
        graph.addNode(node.key, node.attributes);
      }
    }

    const edgeKeys = new Set(nextData.edges.map((edge) => edge.key));
    const removedEdges: string[] = [];
    graph.forEachEdge((key: string) => {
      if (!edgeKeys.has(key)) removedEdges.push(key);
    });
    for (const key of removedEdges) graph.dropEdge(key);

    for (const edge of nextData.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const attributes = {
        ...edge.attributes,
        relationshipType: edge.attributes.type,
        type: "line",
        size: Math.max(0.5, edge.attributes.weight),
        color: "#e2e8f0",
      };
      if (graph.hasEdge(edge.key)) {
        graph.mergeEdgeAttributes(edge.key, attributes);
      } else {
        graph.addEdgeWithKey(edge.key, edge.source, edge.target, attributes);
      }
    }
  }, []);

  const centerOnFocus = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sigma: any,
    nextData: GraphData,
  ) => {
    const display = nextData.focusNodeId
      ? sigma.getNodeDisplayData(nextData.focusNodeId)
      : null;
    const camera = sigma.getCamera();
    if (display) {
      camera.setState({ x: display.x, y: display.y, ratio: 0.5 });
    } else if (!nextData.focusNodeId) {
      camera.setState({ x: 0.5, y: 0.5, ratio: 1 });
    }
  }, []);

  // Initialize Sigma when data arrives — all imports are dynamic
  useEffect(() => {
    if (!data || !containerRef.current) return;
    latestDataRef.current = data;
    if (sigmaRef.current && graphRef.current) {
      applyDataToGraph(graphRef.current, data);
      sigmaRef.current.refresh();
      centerOnFocus(sigmaRef.current, data);
      setGraphRevision((revision) => revision + 1);
      return;
    }
    if (initializingRef.current) return;
    initializingRef.current = true;

    const init = async () => {
      try {
        // Dynamic imports — these only run in the browser
        const graphologyModule = await import("graphology");
        const Graph = graphologyModule.default || graphologyModule;
        const sigmaModule = await import("sigma");
        const Sigma = sigmaModule.Sigma;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const graph = new (Graph as any)({ multi: true, type: "directed" });

        const initialData = latestDataRef.current;
        if (!initialData || !mountedRef.current) return;
        applyDataToGraph(graph, initialData);

        // Run ForceAtlas2 layout
        try {
          const fa2Module = await import("graphology-layout-forceatlas2");
          const forceAtlas2 = fa2Module.default || fa2Module;
          forceAtlas2.assign(graph, {
            iterations: 100,
            settings: {
              gravity: 1,
              scalingRatio: 10,
              barnesHutOptimize: graph.order >= 1000,
              strongGravityMode: false,
              outboundAttractionDistribution: true,
              adjustSizes: true,
            },
          });
        } catch (e) {
          console.warn("[sigma-graph] ForceAtlas2 layout failed, using initial positions", e);
        }

        // Create Sigma renderer
        if (!mountedRef.current || !containerRef.current) return;
        const sigmaInstance = new Sigma(graph, containerRef.current, {
          renderLabels: true,
          labelRenderedSizeThreshold: 8,
          labelSize: 12,
          labelWeight: "bold",
          defaultEdgeColor: "#e2e8f0",
          defaultNodeColor: "#94a3b8",
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
        });

        // Plain click selects a node, exposing a single Focus action.
        // Shift-click remains the graph shortcut for the same action.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sigmaInstance.on("clickNode", (payload: any) => {
          const { node, event } = payload as {
            node: string;
            event?: { original?: MouseEvent | TouchEvent };
          };
          const isShift = isShiftClick(event);
          const attrs = graph.getNodeAttributes(node);

          if (isShift) {
            void focusNodeRef.current({ key: node, attributes: attrs as SigmaNode["attributes"] });
            return;
          }

          setSelectedNode({
            key: node,
            attributes: attrs as SigmaNode["attributes"],
          });
          onNodeClick?.(node);
        });

        sigmaInstance.on("clickStage", () => {
          setSelectedNode(null);
        });

        sigmaRef.current = sigmaInstance;
        graphRef.current = graph;
        if (latestDataRef.current && latestDataRef.current !== initialData) {
          applyDataToGraph(graph, latestDataRef.current);
          sigmaInstance.refresh();
        }
        centerOnFocus(sigmaInstance, latestDataRef.current ?? initialData);
        setGraphRevision((revision) => revision + 1);
      } catch (err) {
        console.error("[sigma-graph] Failed to initialize:", err);
        if (mountedRef.current) setError("Failed to initialize graph renderer");
      } finally {
        initializingRef.current = false;
      }
    };

    void init();
  }, [data, onNodeClick, applyDataToGraph, centerOnFocus]);

  // Search + shift-click flash + cluster highlight: the single node reducer
  // combines all three signals so the amber flash survives even when a
  // search or cluster filter is active. Search and cluster-highlight are
  // ANDed — a node must satisfy every active filter to stay fully visible;
  // failing any one dims it the same way (matches ClusterSidebar's "click a
  // cluster to highlight its nodes" description).
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;

    if (!sigma || !graph) return;

    const hasSearch = Boolean(searchQuery.trim());
    const hasFlash = secondarySetFlash.size > 0;
    const hasClusterFilter = Boolean(highlightedCluster);

    if (!hasSearch && !hasFlash && !hasClusterFilter) {
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      sigma.refresh();
      return;
    }

    const matchingNodes = new Set<string>();
    if (hasSearch) {
      const q = searchQuery.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.forEachNode((node: string, attrs: any) => {
        const label = (attrs.label as string) || "";
        if (label.toLowerCase().includes(q)) {
          matchingNodes.add(node);
        }
      });
    }

    sigma.setSetting(
      "nodeReducer",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: string, data: any) => {
        // Shift-click amber flash wins over search/cluster dimming — the
        // user needs immediate visual confirmation that the secondary was
        // set.
        if (secondarySetFlash.has(node)) {
          return { ...data, color: "#F59E0B", highlighted: true };
        }
        const matchesSearch = !hasSearch || matchingNodes.has(node);
        const matchesCluster =
          !hasClusterFilter || data.clusterId === highlightedCluster;
        if (!matchesSearch || !matchesCluster) {
          return { ...data, color: "#e2e8f0", label: "" };
        }
        if (hasSearch || hasClusterFilter) {
          return { ...data, highlighted: true };
        }
        return data;
      }
    );
    sigma.refresh();
  }, [searchQuery, secondarySetFlash, highlightedCluster]);

  const toggleEdgeType = (type: string) => {
    setEdgeTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleZoomIn = () => {
    sigmaRef.current?.getCamera().animatedZoom({ ratio: 0.5 });
  };

  const handleZoomOut = () => {
    sigmaRef.current?.getCamera().animatedZoom({ ratio: 2 });
  };

  const handleReset = () => {
    sigmaRef.current?.getCamera().animatedReset();
  };

  if (loading) {
    return (
      <div className="h-[600px] flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading graph data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[600px] flex items-center justify-center text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2" data-graph-revision={graphRevision}>
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleZoomIn}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleZoomOut}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleReset}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {data?.stats && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatGraphCounts(data.stats)}
          </span>
        )}
      </div>

      {/* Edge type filters */}
      <div className="flex flex-wrap gap-1 items-center">
        {EDGE_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              edgeTypes.includes(opt.value)
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted/30 border-border text-muted-foreground"
            }`}
            onClick={() => toggleEdgeType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        {/* Phase 4 Track I: provenance-edges lens toggle. Provenance edges
            (evidence_for, derived_from) are hidden by default so the graph
            matches the day-to-day research view. Flipping this on
            cache-busts the graph-data endpoint. */}
        <label
          className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto cursor-pointer"
          title="Show ECC provenance edges (evidence_for, derived_from)"
        >
          <input
            type="checkbox"
            checked={provenanceOn}
            onChange={handleProvenanceToggle}
            className="h-3 w-3"
            data-testid="show-provenance-edges-toggle"
          />
          Show provenance edges
        </label>
      </div>

      {/* Graph container */}
      <div className="relative border rounded-lg overflow-hidden bg-background">
        <div ref={containerRef} className="w-full h-[550px]" />

        {/* Selected node tooltip */}
        {selectedNode && (
          <div className="absolute top-4 right-4 bg-background border rounded-lg shadow-lg p-3 w-60 z-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm truncate">
                {selectedNode.attributes.label}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {selectedNode.attributes.tier}
              </Badge>
            </div>
            {selectedNode.attributes.title && (
              <p className="text-xs text-muted-foreground truncate">
                {selectedNode.attributes.title}
              </p>
            )}
            {selectedNode.attributes.company && (
              <p className="text-xs text-muted-foreground truncate">
                {selectedNode.attributes.company}
              </p>
            )}
            {selectedNode.attributes.kind !== "company" && (
              <div className="grid grid-cols-2 gap-1 mt-2 text-[10px]">
                <span className="text-muted-foreground">PageRank</span>
                <span>{selectedNode.attributes.pagerank.toFixed(6)}</span>
                <span className="text-muted-foreground">Score</span>
                <span>{(selectedNode.attributes.score * 100).toFixed(0)}%</span>
                <span className="text-muted-foreground">Degree</span>
                <span>{selectedNode.attributes.degree}</span>
              </div>
            )}
            <Button
              size="sm"
              className="w-full mt-2 h-7 text-xs"
              disabled={focusPending}
              onClick={() => void focusSelectedNode(selectedNode)}
            >
              {focusPending ? "Focusing..." : "Focus"}
            </Button>
            {focusError && <p role="alert" className="mt-1 text-xs text-destructive">{focusError}</p>}
            {selectedNode.attributes.kind !== "company" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2 h-7 text-xs"
                onClick={() => {
                  window.location.href = `/contacts/${selectedNode.key}`;
                }}
              >
                View Profile
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
