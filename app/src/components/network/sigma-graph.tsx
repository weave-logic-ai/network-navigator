"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { isShiftClick, setSecondaryTargetViaShiftClick } from "./shift-click";
import { contextController, useTargetContext } from "@/lib/targets/context-controller";
import type { ClusterData } from "./cluster-sidebar";

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
    groupIds: string[];
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
  groups: ClusterData[];
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

export function matchesGraphGroup(groupIds: readonly string[] | undefined, selectedGroup: string | null): boolean {
  return !selectedGroup || Boolean(groupIds?.includes(selectedGroup));
}

export function isGraphNodeEmphasized(
  groupIds: readonly string[] | undefined,
  selectedGroup: string | null,
  matchesSearch: boolean,
  isFlashed = false,
): boolean {
  return isFlashed || (matchesSearch && matchesGraphGroup(groupIds, selectedGroup));
}

export function countVisibleGraphGroups(
  groups: ClusterData[],
  nodes: SigmaNode[],
  searchQuery: string,
  selectedGroup: string | null,
  flashedNodes: ReadonlySet<string> = new Set(),
): ClusterData[] {
  const counts = new Map(groups.map((group) => [group.id, 0]));
  const hasSearch = Boolean(searchQuery.trim());
  const queryText = searchQuery.toLowerCase();
  for (const node of nodes) {
    const matchesSearch = !hasSearch || node.attributes.label.toLowerCase().includes(queryText);
    if (!isGraphNodeEmphasized(node.attributes.groupIds, selectedGroup, matchesSearch, flashedNodes.has(node.key))) continue;
    for (const id of node.attributes.groupIds) {
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return groups.map((group) => ({ ...group, visibleCount: counts.get(group.id) ?? 0 }));
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
   * nodes whose `groupIds` don't contain the ID are dimmed the same way a search
   * query dims non-matches — see the node-reducer effect below.
   */
  highlightedCluster?: string | null;
  selectedGroupKey?: string;
  onGroupsStateChange?: (groups: ClusterData[] | null, error: string | null, reloaded?: boolean, requestedGroupId?: string | null) => void;
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
  selectedGroupKey,
  onGroupsStateChange,
  rootTargetId = null,
}: SigmaGraphProps) {
  // Local copy of the toggle: mirrors the parent's value when controlled,
  // otherwise acts as uncontrolled state. Either way, flipping it triggers
  // a refetch (see loadData dep array below) with cache-bust via
  // includeProvenanceEdges=true — matching the Phase 4 §6 behavior.
  const [provenanceOn, setProvenanceOn] = useState<boolean>(showProvenanceEdges);
  const { pending: contextPending } = useTargetContext();
  // The parent supplies the confirmed server root; failed writes leave it intact.
  const activeRootTargetId = rootTargetId;
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedNodeCardRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigmaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const initializingRef = useRef(false);
  const mountedRef = useRef(true);
  const latestDataRef = useRef<GraphData | null>(null);
  const requestSeqRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const groupsCallbackRef = useRef(onGroupsStateChange);
  groupsCallbackRef.current = onGroupsStateChange;
  const selectedGroupRef = useRef({ id: highlightedCluster, key: selectedGroupKey });
  selectedGroupRef.current = { id: highlightedCluster, key: selectedGroupKey };
  const lastSelectionRef = useRef({ id: highlightedCluster, key: selectedGroupKey });
  const [data, setData] = useState<GraphData | null>(null);
  const [graphRevision, setGraphRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<SigmaNode | null>(null);
  useEffect(() => {
    if (selectedNode) selectedNodeCardRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedNode]);
  const [focusError, setFocusError] = useState<string | null>(null);
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
    setFocusError(null);
    const result = await focusGraphNode(node);
    if (!mountedRef.current) return;
    if (!result.ok || !result.secondaryTargetId) {
      setFocusError("Could not focus this node. Please try again.");
      return;
    }
    setSecondarySetFlash((prev) => new Set(prev).add(node.key));
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      setSecondarySetFlash((prev) => {
        const next = new Set(prev);
        next.delete(node.key);
        return next;
      });
    }, 600);
  }, []);
  const focusNodeRef = useRef(focusSelectedNode);
  focusNodeRef.current = focusSelectedNode;

  const loadData = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    requestInFlightRef.current = true;
    setError(null);
    setLoading(true);
    groupsCallbackRef.current?.(null, null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (nicheId) params.set("nicheId", nicheId);
      params.set("edgeTypes", edgeTypes.join(","));
      if (provenanceOn) params.set("includeProvenanceEdges", "true");
      if (activeRootTargetId) params.set("primaryTargetId", activeRootTargetId);
      const requestedGroup = selectedGroupRef.current;
      if (requestedGroup.id) params.set("selectedGroupId", requestedGroup.id);
      if (requestedGroup.key) params.set("selectedGroupKey", requestedGroup.key);

      const res = await fetch(`/api/graph/sigma-data?${params}`);
      if (!res.ok) throw new Error("Failed to load graph data");
      const json = await res.json();
      if (requestSeq === requestSeqRef.current) {
        setData(json.data);
        groupsCallbackRef.current?.(json.data.groups, null, true, requestedGroup.id);
      }
    } catch (err) {
      if (requestSeq === requestSeqRef.current) {
        const message = err instanceof Error ? err.message : "Failed to load graph data";
        setError(message);
        groupsCallbackRef.current?.(null, message);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        requestInFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [limit, nicheId, edgeTypes, provenanceOn, activeRootTargetId]);

  useEffect(() => {
    if (!data || loading || error) return;
    groupsCallbackRef.current?.(countVisibleGraphGroups(data.groups, data.nodes, searchQuery, highlightedCluster, secondarySetFlash), null);
  }, [data, loading, error, searchQuery, highlightedCluster, secondarySetFlash]);

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

  // A selection made while an older request is in flight needs a response
  // pinned to that identity; otherwise the capped catalog may omit it.
  useEffect(() => {
    const last = lastSelectionRef.current;
    if (last.id === highlightedCluster && last.key === selectedGroupKey) return;
    lastSelectionRef.current = { id: highlightedCluster, key: selectedGroupKey };
    if (!highlightedCluster) return;
    if (requestInFlightRef.current || !latestDataRef.current?.groups.some((group) => group.id === highlightedCluster)) {
      void loadData();
    }
  }, [highlightedCluster, selectedGroupKey, loadData]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
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
          defaultDrawNodeLabel: (context, node, settings) => {
            if (!node.label) return;
            const canvasWidth = context.canvas.clientWidth;
            const padding = 4;
            context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
            context.fillStyle = settings.labelColor.attribute
              ? String(node[settings.labelColor.attribute] ?? settings.labelColor.color ?? "#000")
              : settings.labelColor.color ?? "#000";
            let label = node.label;
            while (label.length > 1 && context.measureText(label).width > canvasWidth - padding * 2) {
              label = `${label.slice(0, -2)}…`;
            }
            const labelWidth = context.measureText(label).width;
            const right = node.x + node.size + 3;
            const left = node.x - node.size - 3 - labelWidth;
            const x = right + labelWidth <= canvasWidth - padding
              ? right
              : left >= padding ? left : Math.max(padding, canvasWidth - padding - labelWidth);
            context.fillText(label, x, node.y + settings.labelSize / 3);
          },
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
        if (!isGraphNodeEmphasized(data.groupIds as string[] | undefined, highlightedCluster, matchesSearch)) {
          return { ...data, color: "#e2e8f0", label: "" };
        }
        if (hasSearch || hasClusterFilter) {
          return { ...data, highlighted: true };
        }
        return data;
      }
    );
    sigma.refresh();
  }, [searchQuery, secondarySetFlash, highlightedCluster, graphRevision]);

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

  return (
    <div className="space-y-2 p-2" data-graph-revision={graphRevision}>
      {(loading || error) && (
        <div className="flex items-center gap-2 text-sm" role={error ? "alert" : "status"}>
          {loading && <><Loader2 className="h-4 w-4 animate-spin" />Loading graph data...</>}
          {error && <><span className="text-destructive">{error}</span><Button variant="outline" size="sm" onClick={() => void loadData()}>Retry graph load</Button></>}
        </div>
      )}
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:min-w-[200px] sm:max-w-sm sm:flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            aria-label="Search graph contacts"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Zoom graph in" onClick={handleZoomIn}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Zoom graph out" onClick={handleZoomOut}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" aria-label="Reset graph view" onClick={handleReset}>
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
            aria-pressed={edgeTypes.includes(opt.value)}
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
      <div className="relative min-w-0 border rounded-lg overflow-hidden bg-background">
        <div ref={containerRef} className="w-full h-[550px]" />

        {/* Selected node tooltip */}
        {selectedNode && (
          <div ref={selectedNodeCardRef} role="region" aria-label="Selected graph node" className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-y-auto rounded-lg border bg-background p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:top-4 sm:w-60">
            <div className="flex min-w-0 flex-wrap items-center gap-2 mb-1">
              <span className="min-w-0 break-words font-medium text-sm">
                {selectedNode.attributes.label}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {selectedNode.attributes.tier}
              </Badge>
            </div>
            {selectedNode.attributes.title && (
              <p className="break-words text-xs text-muted-foreground">
                {selectedNode.attributes.title}
              </p>
            )}
            {selectedNode.attributes.company && (
              <p className="break-words text-xs text-muted-foreground">
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
              disabled={contextPending > 0}
              onClick={() => void focusSelectedNode(selectedNode)}
            >
              {contextPending > 0 ? "Focusing..." : "Focus"}
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
      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Graph contacts and companies ({data?.nodes.length ?? 0})</summary>
        <p className="mt-2 text-xs text-muted-foreground">Showing up to 50 matching nodes. Use the graph search to narrow this list.</p>
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {data?.nodes
            .filter((node) => node.attributes.label.toLowerCase().includes(searchQuery.toLowerCase()))
            .slice(0, 50)
            .map((node) => (
              <li key={node.key}>
                <button type="button" className="mr-2 rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => setSelectedNode(node)} aria-label={`Select ${node.attributes.label} in graph`}>Select</button>
                {node.attributes.kind === "company" ? node.attributes.label : (
                  <Link href={`/contacts/${encodeURIComponent(node.key)}`} className="rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {node.attributes.label}
                  </Link>
                )}
                {node.attributes.company && <span className="text-muted-foreground"> — {node.attributes.company}</span>}
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}
