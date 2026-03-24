"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { IcpBuilderModal } from "./icp-builder-modal";
import { DiscoverModal } from "./discover-modal";

interface IcpRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  criteria: Record<string, unknown>;
}

export function IcpsTable() {
  const [icps, setIcps] = useState<IcpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editIcp, setEditIcp] = useState<IcpRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoveries, setDiscoveries] = useState<Array<{
    suggestedName: string; description: string;
    contactCount?: number; confidence?: number;
    criteria?: Record<string, unknown>;
    sampleContactIds?: string[];
  }>>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/icps");
      if (res.ok) {
        const json = await res.json();
        setIcps(json.data ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleNew() {
    setEditIcp(undefined);
    setModalOpen(true);
  }

  function handleEdit(icp: IcpRow) {
    setEditIcp(icp);
    setModalOpen(true);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/icps/${id}`, { method: "DELETE" });
      if (res.ok) {
        setIcps((prev) => prev.filter((i) => i.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  }

  function handleSaved() {
    load();
  }

  async function handleDiscover() {
    setDiscoverOpen(true);
    setDiscoverLoading(true);
    setDiscoveries([]);
    try {
      const res = await fetch("/api/icp/discover");
      if (!res.ok) return;
      const json = await res.json();
      setDiscoveries(json.data?.discoveries ?? []);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function handleAcceptDiscoveries(items: Array<{
    suggestedName: string; description: string;
    criteria?: Record<string, unknown>;
  }>) {
    // Get niches for matching
    const nichesRes = await fetch("/api/niches");
    const nichesJson = await nichesRes.json();
    const existingNiches: Array<{ id: string; name: string }> = nichesJson.data ?? [];

    for (const d of items) {
      const industries = (d.criteria as Record<string, unknown>)?.industries;
      const nicheMatch = Array.isArray(industries)
        ? existingNiches.find((n) =>
            industries.some((ind: string) =>
              n.name.toLowerCase().includes(ind.toLowerCase())
            )
          )
        : undefined;

      await fetch("/api/icp/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nicheId: nicheMatch?.id, discovery: d }),
      });
    }
    load();
  }

  function extractRoles(criteria: Record<string, unknown>): string[] {
    const roles = criteria.roles;
    if (Array.isArray(roles)) return roles as string[];
    return [];
  }

  function extractIndustries(criteria: Record<string, unknown>): string[] {
    const industries = criteria.industries;
    if (Array.isArray(industries)) return industries as string[];
    return [];
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading ICPs...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">ICP Profiles ({icps.length})</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscover}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Discover from Network
              </Button>
              <Button size="sm" onClick={handleNew}>
                <Plus className="h-3 w-3 mr-1" />
                New ICP
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {icps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No ICP profiles defined yet. Create your first ICP to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Name</th>
                    <th className="text-left py-2 pr-3 font-medium">Description</th>
                    <th className="text-center py-2 pr-3 font-medium">Status</th>
                    <th className="text-left py-2 pr-3 font-medium">Roles</th>
                    <th className="text-left py-2 pr-3 font-medium">Industries</th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {icps.map((icp) => {
                    const roles = extractRoles(icp.criteria);
                    const industries = extractIndustries(icp.criteria);
                    return (
                      <tr key={icp.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2.5 pr-3 font-medium">{icp.name}</td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          <span className="truncate max-w-[200px] block">
                            {icp.description ?? "--"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-center">
                          <Badge variant={icp.isActive ? "default" : "secondary"} className="text-[10px]">
                            {icp.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {roles.slice(0, 3).map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">
                                {r}
                              </Badge>
                            ))}
                            {roles.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{roles.length - 3}
                              </Badge>
                            )}
                            {roles.length === 0 && (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            {industries.slice(0, 3).map((ind) => (
                              <Badge key={ind} variant="secondary" className="text-[10px]">
                                {ind}
                              </Badge>
                            ))}
                            {industries.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{industries.length - 3}
                              </Badge>
                            )}
                            {industries.length === 0 && (
                              <span className="text-xs text-muted-foreground">--</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleEdit(icp)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(icp.id)}
                              disabled={deleting === icp.id}
                            >
                              {deleting === icp.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <IcpBuilderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSaved}
        icp={editIcp}
      />

      <DiscoverModal
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        title="Discover ICPs from Network"
        discoveries={discoveries}
        loading={discoverLoading}
        onAccept={handleAcceptDiscoveries}
      />
    </>
  );
}
