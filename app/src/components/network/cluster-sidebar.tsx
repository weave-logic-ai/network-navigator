"use client";

import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ClusterData {
  id: string;
  label: string;
  method: "inferred-community" | "imported-group" | "stored-group" | "company" | "industry";
  totalCount: number;
  loadedCount: number;
  visibleCount: number;
  memberKey?: string;
}

// Catalog pages contain totals only. The graph payload owns counts for nodes
// actually loaded into this view, including filters and capped node sets.
export function reconcileCatalogGroups(catalog: readonly Omit<ClusterData, "loadedCount" | "visibleCount">[], loaded: readonly ClusterData[]): ClusterData[] {
  const groups = new Map<string, ClusterData>();
  for (const group of catalog) groups.set(group.id, { ...group, loadedCount: 0, visibleCount: 0 });
  for (const group of loaded) groups.set(group.id, { ...groups.get(group.id), ...group });
  return [...groups.values()];
}

export function isSelectedGroupRemoved(groups: readonly ClusterData[], selected: string | null, requestedGroupId = selected): boolean {
  return Boolean(selected && selected === requestedGroupId && !groups.some((group) => group.id === selected));
}

interface ClusterSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlightedCluster: string | null;
  onHighlightCluster: (clusterId: string | null, memberKey?: string) => void;
  clusters: ClusterData[];
  loading: boolean;
  error: string | null;
  refreshKey?: number;
  catalogRevision?: number;
}

interface GroupMember { id: string; full_name: string; title: string | null; company: string | null }

export function ClusterSidebar({
  open,
  onOpenChange,
  highlightedCluster,
  onHighlightCluster,
  clusters,
  loading,
  error,
  refreshKey = 0,
  catalogRevision = 0,
}: ClusterSidebarProps) {
  const [extraGroups, setExtraGroups] = useState<ClusterData[]>([]);
  const [catalogCursor, setCatalogCursor] = useState<string | null>("community:");
  const [requestedCatalogCursor, setRequestedCatalogCursor] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const displayClusters = reconcileCatalogGroups(extraGroups, clusters);
  const selectedGroup = displayClusters.find((group) => group.id === highlightedCluster);
  const selectedGroupId = selectedGroup?.id;
  const selectedMemberKey = selectedGroup?.memberKey;
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [requestedCursor, setRequestedCursor] = useState<string | null>(null);
  useEffect(() => {
    setExtraGroups([]);
    setCatalogCursor("community:");
    setRequestedCatalogCursor(null);
  }, [catalogRevision]);
  useEffect(() => {
    if (!open || !requestedCatalogCursor) return;
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    void fetch(`/api/graph/sigma-data?${new URLSearchParams({ catalogCursor: requestedCatalogCursor })}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load more groups");
        return response.json() as Promise<{ data: { groups: Omit<ClusterData, "loadedCount" | "visibleCount">[]; nextCursor: string | null } }>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setExtraGroups((previous) => [...previous, ...result.data.groups.map((group) => ({ ...group, loadedCount: 0, visibleCount: 0 }))]);
        setCatalogCursor(result.data.nextCursor);
      })
      .catch(() => { if (!controller.signal.aborted) setCatalogError("Could not load more groups."); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [open, requestedCatalogCursor, catalogRetry]);
  useEffect(() => {
    if (!open || !selectedGroupId || loading || error) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ memberGroupId: selectedGroupId });
    if (selectedMemberKey) params.set("memberKey", selectedMemberKey);
    if (requestedCursor) params.set("memberCursor", requestedCursor);
    setMembersLoading(true);
    setMembersError(null);
    void fetch(`/api/graph/sigma-data?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load group members");
        return response.json() as Promise<{ data: { members: GroupMember[]; nextCursor: string | null } }>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setMembers((previous) => requestedCursor ? [...previous, ...result.data.members] : result.data.members);
        setNextCursor(result.data.nextCursor);
      })
      .catch(() => { if (!controller.signal.aborted) setMembersError("Could not load group members. Retry below."); })
      .finally(() => { if (!controller.signal.aborted) setMembersLoading(false); });
    return () => controller.abort();
  }, [open, selectedGroupId, selectedMemberKey, loading, error, refreshKey, catalogRevision, retryKey, requestedCursor]);
  // Reset the list whenever the selected identity or graph snapshot changes.
  useEffect(() => {
    setMembers([]);
    setNextCursor(null);
    setRequestedCursor(null);
  }, [highlightedCluster, refreshKey, catalogRevision]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-72 p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="text-sm">Graph groups</SheetTitle>
          <SheetDescription className="text-xs">
            Select a group to highlight its loaded members. Company groups use linked records; stored groups retain recorded memberships. Visible means undimmed by the current search and group selection.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] px-4">
          {highlightedCluster && !loading && !error && !displayClusters.some((group) => group.id === highlightedCluster) && (
            <div role="status" className="mb-3 text-xs text-muted-foreground">
              Selected group was removed during recompute.
              <Button variant="ghost" size="sm" onClick={() => onHighlightCluster(null)}>Clear selection</Button>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading graph groups...
            </div>
          ) : error ? (
            <div role="alert" className="py-8 text-center text-sm text-destructive">{error}</div>
          ) : displayClusters.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No graph groups available.
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {highlightedCluster && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => onHighlightCluster(null)}
                >
                  Clear highlight
                </Button>
              )}
              {selectedGroup && (
                <section aria-label={`${selectedGroup.label} members`} className="rounded-lg border p-3 text-xs">
                  <p className="font-medium">{selectedGroup.label} members</p>
                  <p className="text-muted-foreground">{selectedGroup.totalCount} total · {selectedGroup.loadedCount} on graph</p>
                  {membersError && <p role="alert" className="text-destructive">{membersError} <Button variant="outline" size="sm" onClick={() => setRetryKey((key) => key + 1)}>Retry members</Button></p>}
                  <ul className="mt-2 space-y-2">
                    {members.map((member) => <li key={member.id}>
                      <a className="font-medium underline" href={`/contacts/${member.id}`}>{member.full_name || "Unknown"}</a>
                      {(member.title || member.company) && <p className="text-muted-foreground">{[member.title, member.company].filter(Boolean).join(" · ")}</p>}
                    </li>)}
                  </ul>
                  {membersLoading && <p role="status">Loading members...</p>}
                  {nextCursor && !membersLoading && <Button variant="outline" size="sm" className="mt-2" onClick={() => setRequestedCursor(nextCursor)}>Load more members</Button>}
                  {!membersLoading && !membersError && !members.length && <p className="mt-2 text-muted-foreground">No members found.</p>}
                </section>
              )}
              {displayClusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() =>
                    onHighlightCluster(
                      highlightedCluster === cluster.id ? null : cluster.id,
                      highlightedCluster === cluster.id ? undefined : cluster.memberKey
                    )
                  }
                  className={`
                    w-full rounded-lg border p-3 text-left transition-colors
                    hover:bg-accent/50
                    ${highlightedCluster === cluster.id ? "border-primary bg-accent" : "border-border"}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate max-w-[140px]">
                      {cluster.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] ml-2 shrink-0">
                      {cluster.loadedCount} loaded
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {cluster.visibleCount} visible · {cluster.loadedCount} loaded · {cluster.totalCount} total
                  </p>
                  <div className="mt-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {{ "inferred-community": "Inferred community", "imported-group": "Imported group", "stored-group": "Stored group", company: "Company", industry: "Industry" }[cluster.method]}
                    </Badge>
                  </div>
                </button>
              ))}
              {catalogError && <p role="alert" className="text-xs text-destructive">{catalogError} <Button variant="outline" size="sm" onClick={() => setCatalogRetry((key) => key + 1)}>Retry groups</Button></p>}
              {catalogCursor && <Button variant="outline" size="sm" className="w-full" disabled={catalogLoading} onClick={() => setRequestedCatalogCursor(catalogCursor)}>{catalogLoading ? "Loading groups..." : "Load more groups"}</Button>}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
