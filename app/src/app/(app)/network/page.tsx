"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SigmaGraph } from "@/components/network/sigma-graph";
import { canGraphGoBack, getGraphBackDecision, LatestFocusQueue, writeGraphBack } from "@/components/network/shift-click";
import { ClusterSidebar, isSelectedGroupRemoved, type ClusterData } from "@/components/network/cluster-sidebar";
import { TaxonomyGraph } from "@/components/network/taxonomy-graph";
import { ConversationGraph } from "@/components/network/conversation-graph";
import { KnowledgeGraphView as KnowledgeGraph } from "@/components/network/knowledge-graph";
import { ArrowLeft, Layers, Network, GitBranch, MessageSquare, Brain } from "lucide-react";

// Sigma.js renders the full network server-side filtered to this cap (the
// /api/graph/sigma-data route itself hard-caps at 6000 — see route.ts). This
// replaces the old Reagraph path's hard-coded 300-node limit.
const SIGMA_GRAPH_NODE_LIMIT = 6000;

export default function NetworkPage() {
  const [computing, setComputing] = useState(false);
  const [computeStatus, setComputeStatus] = useState<{ kind: "running" | "success" | "error"; message: string } | null>(null);
  const [backError, setBackError] = useState<string | null>(null);
  const backRetryRef = useRef<{ target: string | null; popHistory: boolean } | null>(null);
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
  // ADR-027 graph re-rooting: the current secondary target id (if any),
  // read from `/api/targets/state` on mount so the Graph tab opens already
  // centered on whatever the user was last looking at (e.g. via the header
  // breadcrumb / target picker). Shift-clicking a node in SigmaGraph updates
  // this optimistically via `onRootTargetIdChange` — see sigma-graph.tsx for
  // why the graph itself owns that write (existing shift-click flow, not a
  // parallel one).
  const [rootTargetId, setRootTargetId] = useState<string | null>(null);
  const rootTargetIdRef = useRef<string | null>(null);
  const rootChangedRef = useRef(false);
  const [rootHistory, setRootHistory] = useState<(string | null)[]>([]);
  const [backPending, setBackPending] = useState(false);
  const [focusPending, setFocusPending] = useState(false);
  const focusPendingRef = useRef(false);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const focusQueueRef = useRef(new LatestFocusQueue<{ ok: boolean; secondaryTargetId?: string | null }>());
  const handleFocusPendingChange = useCallback((pending: boolean) => {
    focusPendingRef.current = pending;
    setFocusPending(pending);
  }, []);

  const handleRootTargetIdChange = useCallback((next: string | null) => {
    if (rootTargetIdRef.current === next) return;
    backRetryRef.current = null;
    setBackError(null);
    rootChangedRef.current = true;
    setRootHistory((history) => [...history, rootTargetIdRef.current]);
    rootTargetIdRef.current = next;
    setRootTargetId(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/targets/state");
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: { secondaryTargetId: string | null } | null;
        };
        if (!cancelled && !rootChangedRef.current && json.data) {
          rootTargetIdRef.current = json.data.secondaryTargetId;
          setRootTargetId(json.data.secondaryTargetId);
          if (json.data.secondaryTargetId) {
            // The persisted target history is a visit log, not a poppable
            // stack: Back itself records a visit there. Replaying it here
            // makes Back alternate between two old targets. A fresh page
            // starts with one safe return point, self; subsequent in-page
            // focus changes build the actual stack below.
            setRootHistory([null]);
          }
        }
      } catch {
        // Silent — graph just falls back to the default top-PageRank view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onTargetChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ secondaryTargetId: string | null }>).detail;
      handleRootTargetIdChange(detail?.secondaryTargetId ?? null);
    };
    window.addEventListener("research-target-changed", onTargetChanged);
    return () => window.removeEventListener("research-target-changed", onTargetChanged);
  }, [handleRootTargetIdChange]);

  const handleBack = useCallback(() => {
    if (backPending || !canGraphGoBack(rootTargetIdRef.current, rootHistory, focusPendingRef.current, backRetryRef.current)) return;
    const pendingFocus = focusPendingRef.current;
    const { target: previous, popHistory } = getGraphBackDecision(rootTargetIdRef.current, rootHistory, pendingFocus, backRetryRef.current);
    handleFocusPendingChange(false);
    setNavigationRevision((revision) => revision + 1);
    setBackPending(true);
    setBackError(null);
    const reconcileFailure = async (isCurrent: () => boolean) => {
      if (!isCurrent()) return;
      backRetryRef.current = { target: previous, popHistory };
      setBackError("Could not return to the previous graph focus. Retry Back.");
      try {
        const response = await fetch("/api/targets/state");
        if (!response.ok) return;
        const state = await response.json() as { data?: { secondaryTargetId?: string | null } | null };
        if (!isCurrent() || !state.data) return;
        const persistedId = state.data.secondaryTargetId ?? null;
        rootTargetIdRef.current = persistedId;
        setRootTargetId(persistedId);
        window.dispatchEvent(new CustomEvent("research-target-changed", {
          detail: { secondaryTargetId: persistedId },
        }));
      } catch {
        // Keep the failure visible if the authoritative state cannot be read.
      }
    };
    void focusQueueRef.current.enqueue(() => writeGraphBack(previous), async (result, isCurrent) => {
      if (!result.ok) {
        await reconcileFailure(isCurrent);
        return;
      }
      backRetryRef.current = null;
      if (popHistory) setRootHistory((history) => history.slice(0, -1));
      rootTargetIdRef.current = previous;
      setRootTargetId(previous);
      window.dispatchEvent(new CustomEvent("research-target-changed", {
        detail: { secondaryTargetId: previous },
      }));
    }, reconcileFailure).finally(() => setBackPending(false));
  }, [backPending, rootHistory, handleFocusPendingChange]);

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

      {(computeStatus || backError || groupNotice) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm" aria-live="polite">
          {computeStatus && <span role={computeStatus.kind === "error" ? "alert" : "status"}
            className={computeStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}>{computeStatus.message}</span>}
          {computeStatus?.kind === "error" && <Button variant="outline" size="sm" onClick={handleCompute} disabled={computing}>Retry compute</Button>}
          {backError && <span role="alert" className="text-destructive">{backError}</span>}
          {backError && <Button variant="outline" size="sm" onClick={handleBack} disabled={backPending}>Retry Back</Button>}
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
            {(rootTargetId || rootHistory.length > 0 || focusPending) && (
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" disabled={backPending} onClick={handleBack}>
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                </Button>
                <span>{rootTargetId ? "Self › Focused target" : "Self"}</span>
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
              onRootTargetIdChange={handleRootTargetIdChange}
              focusQueue={focusQueueRef.current}
              onFocusPendingChange={handleFocusPendingChange}
              navigationRevision={navigationRevision}
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
