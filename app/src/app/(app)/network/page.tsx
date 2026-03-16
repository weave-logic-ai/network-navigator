"use client";

import { useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { NetworkGraph } from "@/components/network/network-graph";
import { GraphControls } from "@/components/network/graph-controls";
import { ClusterSidebar } from "@/components/network/cluster-sidebar";
import type {
  LayoutMode,
  ColorByMode,
  SizeByMode,
  EdgeFilterMode,
} from "@/components/network/network-graph";
import { Layers } from "lucide-react";

export default function NetworkPage() {
  const [computing, setComputing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [layout, setLayout] = useState<LayoutMode>("forceDirected2d");
  const [colorBy, setColorBy] = useState<ColorByMode>("tier");
  const [sizeBy, setSizeBy] = useState<SizeByMode>("score");
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilterMode>("all");
  const [showClusters, setShowClusters] = useState(false);
  const [clusterSidebarOpen, setClusterSidebarOpen] = useState(false);
  const [highlightedCluster, setHighlightedCluster] = useState<string | null>(
    null
  );

  const handleCompute = useCallback(async () => {
    setComputing(true);
    try {
      await fetch("/api/graph/compute", { method: "POST" });
      setRefreshKey((k) => k + 1);
    } catch {
      // Handle error silently
    } finally {
      setComputing(false);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Network Graph"
        description="Visualize your professional network"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClusterSidebarOpen(true)}
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" />
              Communities
            </Button>
            <Button
              size="sm"
              onClick={handleCompute}
              disabled={computing}
            >
              {computing ? "Computing..." : "Compute Graph"}
            </Button>
          </div>
        }
      />

      <div className="flex flex-1 gap-4 overflow-hidden">
        <GraphControls
          layout={layout}
          colorBy={colorBy}
          sizeBy={sizeBy}
          edgeFilter={edgeFilter}
          showClusters={showClusters}
          onLayoutChange={setLayout}
          onColorByChange={setColorBy}
          onSizeByChange={setSizeBy}
          onEdgeFilterChange={setEdgeFilter}
          onShowClustersChange={setShowClusters}
        />

        <div className="relative flex-1 rounded-lg border bg-background overflow-hidden">
          <NetworkGraph
            layout={layout}
            colorBy={colorBy}
            sizeBy={sizeBy}
            edgeFilter={edgeFilter}
            showClusters={showClusters}
            highlightedCluster={highlightedCluster}
            refreshKey={refreshKey}
          />
        </div>
      </div>

      <ClusterSidebar
        open={clusterSidebarOpen}
        onOpenChange={setClusterSidebarOpen}
        highlightedCluster={highlightedCluster}
        onHighlightCluster={setHighlightedCluster}
      />
    </div>
  );
}
