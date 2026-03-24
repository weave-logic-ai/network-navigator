"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

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
  stats: {
    totalNodes: number;
    loadedNodes: number;
    totalEdges: number;
    communities: number;
  };
}

interface SigmaGraphProps {
  nicheId?: string;
  edgeTypes?: string[];
  limit?: number;
  onNodeClick?: (nodeId: string) => void;
}

const EDGE_TYPE_OPTIONS = [
  { value: "CONNECTED_TO", label: "Connected" },
  { value: "MESSAGED", label: "Messaged" },
  { value: "same-company", label: "Same Company" },
  { value: "INVITED_BY", label: "Invited" },
  { value: "ENDORSED", label: "Endorsed" },
  { value: "RECOMMENDED", label: "Recommended" },
];

export function SigmaGraph({
  nicheId,
  edgeTypes: initialEdgeTypes,
  limit = 500,
  onNodeClick,
}: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigmaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<SigmaNode | null>(null);
  const [edgeTypes, setEdgeTypes] = useState<string[]>(
    initialEdgeTypes || EDGE_TYPE_OPTIONS.map((o) => o.value)
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (nicheId) params.set("nicheId", nicheId);
      if (edgeTypes.length > 0) params.set("edgeTypes", edgeTypes.join(","));

      const res = await fetch(`/api/graph/sigma-data?${params}`);
      if (!res.ok) throw new Error("Failed to load graph data");
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [limit, nicheId, edgeTypes]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Initialize Sigma when data arrives — all imports are dynamic
  useEffect(() => {
    if (!data || !containerRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sigmaInstance: any = null;

    const init = async () => {
      try {
        // Dynamic imports — these only run in the browser
        const graphologyModule = await import("graphology");
        const Graph = graphologyModule.default || graphologyModule;
        const sigmaModule = await import("sigma");
        const Sigma = sigmaModule.Sigma;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const graph = new (Graph as any)({ multi: true, type: "directed" });

        // Add nodes
        for (const node of data.nodes) {
          if (!graph.hasNode(node.key)) {
            graph.addNode(node.key, {
              ...node.attributes,
              label: node.attributes.label,
            });
          }
        }

        // Add edges
        for (const edge of data.edges) {
          if (
            graph.hasNode(edge.source) &&
            graph.hasNode(edge.target)
          ) {
            try {
              graph.addEdgeWithKey(edge.key, edge.source, edge.target, {
                ...edge.attributes,
                size: Math.max(0.5, edge.attributes.weight),
                color: "#e2e8f0",
              });
            } catch {
              // Skip duplicate edges
            }
          }
        }

        graphRef.current = graph;

        // Run ForceAtlas2 layout
        try {
          const fa2Module = await import("graphology-layout-forceatlas2");
          const forceAtlas2 = fa2Module.default || fa2Module;
          forceAtlas2.assign(graph, {
            iterations: 100,
            settings: {
              gravity: 1,
              scalingRatio: 10,
              barnesHutOptimize: graph.order > 1000,
              strongGravityMode: false,
              outboundAttractionDistribution: true,
              adjustSizes: true,
            },
          });
        } catch (e) {
          console.warn("[sigma-graph] ForceAtlas2 layout failed, using initial positions", e);
        }

        // Create Sigma renderer
        sigmaInstance = new Sigma(graph, containerRef.current!, {
          renderLabels: true,
          labelRenderedSizeThreshold: 8,
          labelSize: 12,
          labelWeight: "bold",
          defaultEdgeColor: "#e2e8f0",
          defaultNodeColor: "#94a3b8",
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
        });

        // Click handler
        sigmaInstance.on("clickNode", ({ node }: { node: string }) => {
          const attrs = graph.getNodeAttributes(node);
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
      } catch (err) {
        console.error("[sigma-graph] Failed to initialize:", err);
        setError("Failed to initialize graph renderer");
      }
    };

    init();

    return () => {
      if (sigmaInstance) {
        try {
          sigmaInstance.kill();
        } catch {
          // Ignore cleanup errors
        }
        sigmaInstance = null;
      }
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [data, onNodeClick]);

  // Search: highlight matching nodes
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;

    if (!sigma || !graph) return;

    if (!searchQuery.trim()) {
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      sigma.refresh();
      return;
    }

    const q = searchQuery.toLowerCase();
    const matchingNodes = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph.forEachNode((node: string, attrs: any) => {
      const label = (attrs.label as string) || "";
      if (label.toLowerCase().includes(q)) {
        matchingNodes.add(node);
      }
    });

    sigma.setSetting(
      "nodeReducer",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: string, data: any) => {
        if (matchingNodes.size === 0) return data;
        if (matchingNodes.has(node)) {
          return { ...data, highlighted: true };
        }
        return { ...data, color: "#e2e8f0", label: "" };
      }
    );
    sigma.refresh();
  }, [searchQuery]);

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
    <div className="space-y-2 p-2">
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
            {data.stats.loadedNodes}/{data.stats.totalNodes} nodes, {data.stats.totalEdges} edges
          </span>
        )}
      </div>

      {/* Edge type filters */}
      <div className="flex flex-wrap gap-1">
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
            <div className="grid grid-cols-2 gap-1 mt-2 text-[10px]">
              <span className="text-muted-foreground">PageRank</span>
              <span>{selectedNode.attributes.pagerank.toFixed(6)}</span>
              <span className="text-muted-foreground">Score</span>
              <span>{(selectedNode.attributes.score * 100).toFixed(0)}%</span>
              <span className="text-muted-foreground">Degree</span>
              <span>{selectedNode.attributes.degree}</span>
            </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
