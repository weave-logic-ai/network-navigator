"use client";

import { useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SigmaGraph } from "@/components/network/sigma-graph";
import { ClusterSidebar } from "@/components/network/cluster-sidebar";
import { TaxonomyGraph } from "@/components/network/taxonomy-graph";
import { ConversationGraph } from "@/components/network/conversation-graph";
import { KnowledgeGraphView as KnowledgeGraph } from "@/components/network/knowledge-graph";
import { Layers, Network, GitBranch, MessageSquare, Brain } from "lucide-react";

// Sigma.js renders the full network server-side filtered to this cap (the
// /api/graph/sigma-data route itself hard-caps at 6000 — see route.ts). This
// replaces the old Reagraph path's hard-coded 300-node limit.
const SIGMA_GRAPH_NODE_LIMIT = 6000;

export default function NetworkPage() {
  const [computing, setComputing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clusterSidebarOpen, setClusterSidebarOpen] = useState(false);
  const [highlightedCluster, setHighlightedCluster] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("graph");

  const handleCompute = useCallback(async () => {
    setComputing(true);
    try {
      await fetch("/api/graph/compute", { method: "POST" });
      setRefreshKey((k) => k + 1);
    } catch {
      // silent
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
            {activeTab === "graph" && (
              <>
                <Button variant="outline" size="sm" onClick={() => setClusterSidebarOpen(true)}>
                  <Layers className="mr-1.5 h-3.5 w-3.5" />
                  Communities
                </Button>
                <Button size="sm" onClick={handleCompute} disabled={computing}>
                  {computing ? "Computing..." : "Compute Graph"}
                </Button>
              </>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-0 w-fit">
          <TabsTrigger value="graph" className="gap-1.5">
            <Network className="h-3.5 w-3.5" />
            Graph
          </TabsTrigger>
          <TabsTrigger value="taxonomy" className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Taxonomy
          </TabsTrigger>
          <TabsTrigger value="conversations" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Conversations
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Knowledge
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="flex flex-1 gap-4 overflow-hidden mt-4">
          <div className="relative flex-1 rounded-lg border bg-background overflow-hidden">
            {/* `key={refreshKey}` forces a remount (and refetch) when
                "Compute Graph" runs, since SigmaGraph loads its own data
                internally rather than taking it as a prop. */}
            <SigmaGraph
              key={refreshKey}
              limit={SIGMA_GRAPH_NODE_LIMIT}
              highlightedCluster={highlightedCluster}
            />
          </div>
        </TabsContent>

        <TabsContent value="taxonomy" className="flex-1 overflow-hidden mt-4">
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <TaxonomyGraph />
          </div>
        </TabsContent>

        <TabsContent value="conversations" className="flex-1 overflow-hidden mt-4">
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <ConversationGraph />
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="flex-1 overflow-hidden mt-4">
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <KnowledgeGraph />
          </div>
        </TabsContent>
      </Tabs>

      <ClusterSidebar
        open={clusterSidebarOpen} onOpenChange={setClusterSidebarOpen}
        highlightedCluster={highlightedCluster} onHighlightCluster={setHighlightedCluster}
      />
    </div>
  );
}
