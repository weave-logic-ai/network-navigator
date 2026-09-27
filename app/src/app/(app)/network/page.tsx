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
import { contextController, useTargetContext } from "@/lib/targets/context-controller";
import { ArrowLeft, Layers, Network, GitBranch, MessageSquare, Brain } from "lucide-react";

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
  const { snapshot, pending, error: contextError } = useTargetContext();
  const rootTargetId = snapshot?.secondaryTargetId ?? null;
  const handleBack = useCallback(() => { void contextController.back().catch(() => undefined); }, []);

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
    <div className="flex min-w-0 h-[calc(100vh-7rem)] flex-col">
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
        <div className="min-w-0 w-full overflow-x-auto">
        <TabsList className="mx-0 w-max">
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
        </div>

        <TabsContent value="graph" className="hidden min-h-0 flex-1 gap-4 overflow-hidden mt-4 data-[state=active]:flex">
          <div className="relative flex-1 rounded-lg border bg-background overflow-hidden">
            {(rootTargetId || snapshot?.canGoBack) && (
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" disabled={pending > 0 || !snapshot?.canGoBack} onClick={handleBack}>
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                </Button>
                <span>{rootTargetId ? `Self › ${snapshot?.focusLabel ?? "Focused target"}` : "Self"}</span>
                {contextError && <span role="status">{contextError}</span>}
              </div>
            )}
            {/* `key={refreshKey}` forces a remount (and refetch) when
                "Compute Graph" runs, since SigmaGraph loads its own data
                internally rather than taking it as a prop. */}
            <SigmaGraph
              key={refreshKey}
              limit={SIGMA_GRAPH_NODE_LIMIT}
              highlightedCluster={highlightedCluster}
              rootTargetId={rootTargetId}
            />
          </div>
        </TabsContent>

        <TabsContent value="taxonomy" className="min-h-0 flex-1 overflow-hidden mt-4 data-[state=inactive]:hidden">
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <TaxonomyGraph />
          </div>
        </TabsContent>

        <TabsContent value="conversations" className="min-h-0 flex-1 overflow-hidden mt-4 data-[state=inactive]:hidden">
          <div className="h-full rounded-lg border bg-background overflow-hidden">
            <ConversationGraph />
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="min-h-0 flex-1 overflow-y-auto mt-4 data-[state=inactive]:hidden lg:overflow-hidden">
          <div className="min-h-full rounded-lg border bg-background lg:h-full lg:overflow-hidden">
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
