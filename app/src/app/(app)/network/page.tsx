"use client";

import { useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SigmaGraph } from "@/components/network/sigma-graph";
import { ClusterSidebar, isSelectedGroupRemoved, type ClusterData } from "@/components/network/cluster-sidebar";
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
  const [computeStatus, setComputeStatus] = useState<{ kind: "running" | "success" | "error"; message: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clusterSidebarOpen, setClusterSidebarOpen] = useState(false);
  const [highlightedCluster, setHighlightedCluster] = useState<string | null>(null);
  const highlightedClusterRef = useRef(highlightedCluster);
  highlightedClusterRef.current = highlightedCluster;
  const [graphGroups, setGraphGroups] = useState<ClusterData[]>([]);
  const graphGroupsRef = useRef<ClusterData[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | undefined>();
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const handleGroupsStateChange = useCallback((groups: ClusterData[] | null, error: string | null, reloaded = false, requestedGroupId?: string | null) => {
    // Keep the catalog usable while a graph filter refetch is in flight.
    setGroupsLoading(groups === null && error === null && graphGroupsRef.current.length === 0);
    setGroupsError(error);
    if (groups) {
      graphGroupsRef.current = groups;
      setGraphGroups(groups);
      if (reloaded) setCatalogRevision((revision) => revision + 1);
      const selected = highlightedClusterRef.current;
      if (reloaded && isSelectedGroupRemoved(groups, selected, requestedGroupId)) {
        highlightedClusterRef.current = null;
        setHighlightedCluster(null);
        setSelectedGroupKey(undefined);
        setGroupNotice("The selected group was removed; its highlight was cleared.");
      }
    }
  }, []);
  const handleHighlightCluster = useCallback((id: string | null, memberKey?: string) => {
    highlightedClusterRef.current = id;
    setHighlightedCluster(id);
    setSelectedGroupKey(memberKey);
    setGroupNotice(null);
  }, []);
  const [activeTab, setActiveTab] = useState("graph");
  const { snapshot, pending, error: contextError } = useTargetContext();
  const rootTargetId = snapshot?.secondaryTargetId ?? null;
  const handleBack = useCallback(() => { void contextController.back().catch(() => undefined); }, []);

  const handleCompute = useCallback(async () => {
    if (computing) return;
    setComputing(true);
    setComputeStatus({ kind: "running", message: "Computing metrics and groups. The current graph remains available." });
    try {
      const response = await fetch("/api/graph/compute", { method: "POST" });
      const body = await response.json() as {
        data?: { metricsComputed: number; communitiesDetected: number; communityMethod: "spectral" | "linked-company-fallback" };
        error?: string;
        details?: string;
      };
      if (!response.ok || !body.data) throw new Error(body.details || body.error || `Graph compute failed (${response.status})`);
      const fallback = body.data.communityMethod === "linked-company-fallback"
        ? " Linked-company fallback was used because spectral groups were unavailable."
        : "";
      const groupLabel = body.data.communitiesDetected === 1 ? "group" : "groups";
      setComputeStatus({ kind: "success", message: `Computed ${body.data.metricsComputed} contact metrics and ${body.data.communitiesDetected} ${groupLabel}.${fallback}` });
      setRefreshKey((k) => k + 1);
    } catch (error) {
      setComputeStatus({ kind: "error", message: error instanceof Error ? error.message : "Graph computation ended, but its result could not be verified. Refresh the graph before retrying." });
    } finally {
      setComputing(false);
    }
  }, [computing]);

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

      {(computeStatus || contextError || groupNotice) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm" aria-live="polite">
          {computeStatus && <span role={computeStatus.kind === "error" ? "alert" : "status"}
            className={computeStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}>{computeStatus.message}</span>}
          {computeStatus?.kind === "error" && <Button variant="outline" size="sm" onClick={handleCompute} disabled={computing}>Retry compute</Button>}
          {contextError && <span role="alert" className="text-destructive">{contextError}</span>}
          {groupNotice && <span role="status" className="text-muted-foreground">{groupNotice}</span>}
        </div>
      )}

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
              </div>
            )}
            {/* `key={refreshKey}` forces a remount (and refetch) when
                "Compute Graph" runs, since SigmaGraph loads its own data
                internally rather than taking it as a prop. */}
            <SigmaGraph
              key={refreshKey}
              limit={SIGMA_GRAPH_NODE_LIMIT}
              highlightedCluster={highlightedCluster}
              selectedGroupKey={selectedGroupKey}
              onGroupsStateChange={handleGroupsStateChange}
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
        highlightedCluster={highlightedCluster} onHighlightCluster={handleHighlightCluster}
        clusters={graphGroups} loading={groupsLoading} error={groupsError}
        refreshKey={refreshKey}
        catalogRevision={catalogRevision}
      />
    </div>
  );
}
