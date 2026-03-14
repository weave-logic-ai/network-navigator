"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface IcpProfile {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  criteria: Record<string, unknown>;
}

interface IcpDiscovery {
  suggestedName: string;
  description: string;
  criteria: {
    titlePatterns: string[];
    industries: string[];
    companySizes: string[];
    locations: string[];
  };
  contactCount: number;
  confidence: number;
  sampleContactIds: string[];
}

export default function DiscoverPage() {
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [discoveries, setDiscoveries] = useState<IcpDiscovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [profilesRes, discoverRes] = await Promise.all([
        fetch("/api/icp/profiles"),
        fetch("/api/icp/discover"),
      ]);

      if (profilesRes.ok) {
        const json = await profilesRes.json();
        setProfiles(json.data || []);
      }

      if (discoverRes.ok) {
        const json = await discoverRes.json();
        setDiscoveries(json.data || []);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscover() {
    setDiscovering(true);
    try {
      const res = await fetch("/api/icp/discover?minSize=2");
      if (res.ok) {
        const json = await res.json();
        setDiscoveries(json.data || []);
      }
    } catch {
      // Handle error
    } finally {
      setDiscovering(false);
    }
  }

  async function createProfile(discovery: IcpDiscovery) {
    try {
      const res = await fetch("/api/icp/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: discovery.suggestedName,
          description: discovery.description,
          criteria: {
            roles: discovery.criteria.titlePatterns,
            industries: discovery.criteria.industries,
            companySizeRanges: discovery.criteria.companySizes,
            locations: discovery.criteria.locations,
          },
        }),
      });

      if (res.ok) {
        await loadData();
      }
    } catch {
      // Handle error
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Discover" />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Discover"
        description="Find ideal customer profiles in your network"
        actions={
          <Button onClick={handleDiscover} disabled={discovering}>
            {discovering ? "Analyzing..." : "Discover ICPs"}
          </Button>
        }
      />

      {profiles.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Active ICP Profiles</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <Card key={profile.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{profile.name}</CardTitle>
                    <Badge
                      variant={profile.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {profile.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {profile.description && (
                    <p className="text-xs text-muted-foreground">
                      {profile.description}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {discoveries.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold mb-3">Discovered Niches</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {discoveries.map((discovery, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {discovery.suggestedName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {discovery.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {discovery.criteria.titlePatterns.map((p) => (
                      <Badge key={p} variant="outline" className="text-xs">
                        {p}
                      </Badge>
                    ))}
                    {discovery.criteria.industries.map((ind) => (
                      <Badge key={ind} variant="secondary" className="text-xs">
                        {ind}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 flex-1 mr-4">
                      <div className="flex items-center justify-between text-xs">
                        <span>Confidence</span>
                        <span>{(discovery.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <Progress
                        value={discovery.confidence * 100}
                        className="h-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => createProfile(discovery)}
                    >
                      Create ICP
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {discovery.contactCount} matching contacts
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto max-w-md space-y-3">
              <h3 className="text-lg font-medium">No niches discovered</h3>
              <p className="text-sm text-muted-foreground">
                Click &quot;Discover ICPs&quot; to find ideal customer profiles based
                on your imported contacts.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
