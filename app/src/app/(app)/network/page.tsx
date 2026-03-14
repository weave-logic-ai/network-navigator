"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ClusterData {
  id: string;
  label: string;
  description: string | null;
  memberCount: number;
  algorithm: string;
  metadata: Record<string, unknown>;
}

export default function NetworkPage() {
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    loadClusters();
  }, []);

  async function loadClusters() {
    try {
      const res = await fetch("/api/graph/communities");
      if (res.ok) {
        const json = await res.json();
        setClusters(json.data || []);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }

  async function handleCompute() {
    setComputing(true);
    try {
      await fetch("/api/graph/compute", { method: "POST" });
      await loadClusters();
    } catch {
      // Handle error
    } finally {
      setComputing(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Network Graph"
        description="Visualize your professional network"
        actions={
          <Button onClick={handleCompute} disabled={computing}>
            {computing ? "Computing..." : "Compute Graph"}
          </Button>
        }
      />

      {loading ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto max-w-md space-y-3">
              <h3 className="text-lg font-medium">No graph data yet</h3>
              <p className="text-sm text-muted-foreground">
                Click &quot;Compute Graph&quot; to analyze your network and detect
                communities. You need imported contacts first.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{clusters.length}</p>
                  <p className="text-xs text-muted-foreground">Communities</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {clusters.reduce((sum, c) => sum + c.memberCount, 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Connected Contacts
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {Math.round(
                      clusters.reduce((sum, c) => sum + c.memberCount, 0) /
                        (clusters.length || 1)
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">Avg Size</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {clusters.map((cluster) => (
              <Card key={cluster.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm truncate">
                    {cluster.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {cluster.memberCount} members
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {cluster.algorithm}
                    </Badge>
                  </div>
                  {cluster.description && (
                    <p className="text-xs text-muted-foreground mt-2 truncate">
                      {cluster.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
