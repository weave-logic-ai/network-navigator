"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WedgeChart } from "@/components/discover/wedge-chart";
import { IcpTreemap } from "@/components/discover/icp-treemap";
import { IcpBuilder } from "@/components/discover/icp-builder";
import { NichePanel } from "@/components/discover/niche-panel";
import { IcpPanel } from "@/components/discover/icp-panel";
import { SupportingCharts } from "@/components/discover/supporting-charts";
import { Loader2 } from "lucide-react";

interface NicheData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  topContacts: Array<{ id: string; name: string; score: number; tier: string }>;
}

interface IcpData {
  id: string;
  name: string;
  matchCount: number;
  firstDegreeCount: number;
  secondDegreeCount: number;
  criteria: Record<string, unknown>;
}

interface WedgeResponse {
  niches: NicheData[];
  icps: IcpData[];
  totalContacts: number;
}

export default function DiscoverPage() {
  const [data, setData] = useState<WedgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [selectedIcp, setSelectedIcp] = useState<string | null>(null);
  const [showNetwork, setShowNetwork] = useState<"all" | "first" | "second">("all");
  const [minSize, setMinSize] = useState(2);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/discover/wedge-data");
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch {
      // Empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleDiscover() {
    setDiscovering(true);
    try {
      await fetch(`/api/icp/discover?minSize=${minSize}`);
      await loadData();
    } catch {
      // Handle error
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSaveIcp(profile: {
    name: string;
    description: string;
    criteria: {
      roles: string[];
      industries: string[];
      companySizeRanges: string[];
      locations: string[];
      minConnections: number;
      signals: string[];
    };
  }) {
    const res = await fetch("/api/icp/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profile.name,
        description: profile.description,
        criteria: profile.criteria,
      }),
    });

    if (res.ok) {
      await loadData();
    }
  }

  async function handlePreviewCount(criteria: Record<string, unknown>): Promise<number> {
    // Estimate by counting contacts that match criteria
    try {
      const params = new URLSearchParams();
      const roles = criteria.roles as string[] | undefined;
      if (roles?.length) params.set("roles", roles.join(","));
      const industries = criteria.industries as string[] | undefined;
      if (industries?.length) params.set("industries", industries.join(","));

      const res = await fetch(`/api/contacts?limit=1&${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        return json.pagination?.total ?? 0;
      }
    } catch {
      // fallback
    }
    return 0;
  }

  function handleGrow() {
    setMinSize((prev) => Math.max(1, prev - 1));
    handleDiscover();
  }

  function handleShrink() {
    setMinSize((prev) => prev + 1);
    handleDiscover();
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Discover" />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading...
        </div>
      </div>
    );
  }

  const niches = data?.niches ?? [];
  const icps = data?.icps ?? [];
  const totalContacts = data?.totalContacts ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Discover"
        description="Explore niches, visualize ICP profiles, and build targeted segments"
        actions={
          <Button onClick={handleDiscover} disabled={discovering} size="sm">
            {discovering ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Discover ICPs"
            )}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_220px]">
        {/* Left: Niche Panel */}
        <div className="hidden lg:block">
          <NichePanel
            niches={niches}
            selectedNiche={selectedNiche}
            onNicheSelect={setSelectedNiche}
            onGrow={handleGrow}
            onShrink={handleShrink}
          />
        </div>

        {/* Center: Tabbed Visualizations */}
        <div>
          <Tabs defaultValue="wedge" className="w-full">
            <TabsList className="mb-3">
              <TabsTrigger value="wedge">Wedge</TabsTrigger>
              <TabsTrigger value="treemap">Treemap</TabsTrigger>
              <TabsTrigger value="builder">ICP Builder</TabsTrigger>
            </TabsList>

            <TabsContent value="wedge" className="mt-0">
              <WedgeChart
                niches={niches}
                totalContacts={totalContacts}
                selectedNiche={selectedNiche}
                onNicheSelect={setSelectedNiche}
              />
            </TabsContent>

            <TabsContent value="treemap" className="mt-0">
              <IcpTreemap
                niches={niches}
                icps={icps}
                selectedIcp={selectedIcp}
                onIcpSelect={setSelectedIcp}
              />
            </TabsContent>

            <TabsContent value="builder" className="mt-0">
              <IcpBuilder
                onSave={handleSaveIcp}
                onPreviewCount={handlePreviewCount}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: ICP Panel */}
        <div className="hidden lg:block">
          <IcpPanel
            icps={icps}
            selectedIcp={selectedIcp}
            onIcpSelect={setSelectedIcp}
            showNetwork={showNetwork}
            onNetworkToggle={setShowNetwork}
          />
        </div>
      </div>

      {/* Mobile: Niche + ICP panels stacked */}
      <div className="grid gap-4 md:grid-cols-2 lg:hidden">
        <NichePanel
          niches={niches}
          selectedNiche={selectedNiche}
          onNicheSelect={setSelectedNiche}
          onGrow={handleGrow}
          onShrink={handleShrink}
        />
        <IcpPanel
          icps={icps}
          selectedIcp={selectedIcp}
          onIcpSelect={setSelectedIcp}
          showNetwork={showNetwork}
          onNetworkToggle={setShowNetwork}
        />
      </div>

      {/* Supporting Charts */}
      <SupportingCharts
        niches={niches}
        selectedNiche={selectedNiche}
        selectedIcp={selectedIcp}
        icps={icps}
      />
    </div>
  );
}
