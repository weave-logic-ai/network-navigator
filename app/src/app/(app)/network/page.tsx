"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SigmaGraph } from "@/components/network/sigma-graph";
import { ClusterSidebar } from "@/components/network/cluster-sidebar";
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [clusterSidebarOpen, setClusterSidebarOpen] = useState(false);
  const [highlightedCluster, setHighlightedCluster] = useState<string | null>(null);
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

  const handleRootTargetIdChange = useCallback((next: string | null) => {
    if (rootTargetIdRef.current === next) return;
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

  const handleBack = useCallback(async () => {
    if ((!rootTargetIdRef.current && rootHistory.length === 0) || backPending) return;
    const previous = rootHistory.length > 0 ? rootHistory[rootHistory.length - 1] : null;
    setBackPending(true);
    try {
      const response = await fetch("/api/targets/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secondaryTargetId: previous }),
      });
      if (!response.ok) return;
      setRootHistory((history) => history.slice(0, -1));
      rootTargetIdRef.current = previous;
      setRootTargetId(previous);
      window.dispatchEvent(new CustomEvent("research-target-changed", {
        detail: { secondaryTargetId: previous },
      }));
    } catch {
      // Preserve the current focus so Back can be retried.
    } finally {
      setBackPending(false);
    }
  }, [backPending, rootHistory]);

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
            {(rootTargetId || rootHistory.length > 0) && (
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
              rootTargetId={rootTargetId}
              onRootTargetIdChange={handleRootTargetIdChange}
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
