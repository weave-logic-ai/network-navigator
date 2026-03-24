"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WedgeChart } from "@/components/discover/wedge-chart";
import { IcpTreemap } from "@/components/discover/icp-treemap";
import { NichesTable } from "@/components/discover/niches-table";
import { IcpsTable } from "@/components/discover/icps-table";
import { PeoplePanel } from "@/components/discover/people-panel";
import { HistoryPanel } from "@/components/discover/history-panel";
import { Loader2, X } from "lucide-react";
import { useGoalEngine } from "@/hooks/use-goal-engine";

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

interface IcpProfile {
  id: string;
  name: string;
  nicheId: string | null;
  isActive: boolean;
}

interface Offering {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface NicheProfile {
  id: string;
  name: string;
  description: string | null;
  industryId: string | null;
  keywords: string[];
  memberCount: number;
}

export default function DiscoverPage() {
  const [niches, setNiches] = useState<NicheData[]>([]);
  const [icps, setIcps] = useState<IcpData[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [addressedCount, setAddressedCount] = useState(0);
  const [unaddressedCount, setUnaddressedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [selectedIcp, setSelectedIcp] = useState<string | null>(null);

  // Goal engine — fires on niche/ICP selection changes
  useGoalEngine({
    selectedNicheId: selectedNiche ?? undefined,
    selectedIcpId: selectedIcp ?? undefined,
  });

  // Niche profiles (user-defined) for dropdown
  const [nicheProfiles, setNicheProfiles] = useState<NicheProfile[]>([]);

  // ICP profiles (user-defined) for dropdown — distinct from wedge-data ICPs
  const [icpProfiles, setIcpProfiles] = useState<IcpProfile[]>([]);

  // Offerings
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [selectedOfferings, setSelectedOfferings] = useState<string[]>([]);
  const [offeringInput, setOfferingInput] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [wedgeRes, offeringsRes, nichesRes, icpsRes] = await Promise.all([
        fetch("/api/discover/wedge-data"),
        fetch("/api/offerings"),
        fetch("/api/niches"),
        fetch("/api/icps"),
      ]);
      if (wedgeRes.ok) {
        const json = await wedgeRes.json();
        setNiches(json.data?.niches ?? []);
        setIcps(json.data?.icps ?? []);
        setTotalContacts(json.data?.totalContacts ?? 0);
        setAddressedCount(json.data?.addressedCount ?? 0);
        setUnaddressedCount(json.data?.unaddressedCount ?? 0);
      }
      if (offeringsRes.ok) {
        const json = await offeringsRes.json();
        setOfferings(json.data || []);
      }
      if (nichesRes.ok) {
        const json = await nichesRes.json();
        setNicheProfiles(json.data || []);
      }
      if (icpsRes.ok) {
        const json = await icpsRes.json();
        setIcpProfiles(json.data || []);
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

  async function addOffering() {
    const name = offeringInput.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/offerings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const json = await res.json();
        const newOffering = json.data;
        setOfferings((prev) => [...prev, newOffering]);
        setSelectedOfferings((prev) => [...prev, newOffering.id]);
        setOfferingInput("");
      }
    } catch {
      // ignore
    }
  }

  function toggleOffering(id: string) {
    setSelectedOfferings((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]
    );
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

  return (
    <div className="space-y-4">
      <PageHeader title="Discover" />

      {/* Controls row: Niche, ICP, Offerings */}
      <div className="flex flex-wrap items-start gap-4">
        {/* Niche selector */}
        <div className="w-48">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Niche</label>
          <Select
            value={selectedNiche ?? "all"}
            onValueChange={(v) => {
              setSelectedNiche(v === "all" ? null : v);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All niches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All niches</SelectItem>
              {nicheProfiles.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ICP Profile selector — filtered by selected niche */}
        <div className="w-48">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">ICP Profile</label>
          <Select
            value={selectedIcp ?? "all"}
            onValueChange={(v) => setSelectedIcp(v === "all" ? null : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="All ICPs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ICPs</SelectItem>
              {icpProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Offerings multi-select */}
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Offerings</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 min-h-[32px]">
            {selectedOfferings.map((id) => {
              const o = offerings.find((x) => x.id === id);
              if (!o) return null;
              return (
                <Badge key={id} variant="secondary" className="text-xs gap-1 pr-1">
                  {o.name}
                  <button
                    type="button"
                    className="ml-0.5 hover:text-foreground"
                    onClick={() => toggleOffering(id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            <Select onValueChange={(v) => toggleOffering(v)}>
              <SelectTrigger className="h-6 w-auto border-0 shadow-none text-xs px-1 min-w-[80px]">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {offerings
                  .filter((o) => !selectedOfferings.includes(o.id))
                  .map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              className="h-6 border-0 shadow-none text-xs w-[140px] px-1"
              placeholder="Add new..."
              value={offeringInput}
              onChange={(e) => setOfferingInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOffering();
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Tabs: Wedge, Treemap, Niches, ICPs */}
      <Tabs defaultValue="wedge" className="w-full">
        <TabsList className="mb-3">
          <TabsTrigger value="wedge">Wedge</TabsTrigger>
          <TabsTrigger value="treemap">Treemap</TabsTrigger>
          <TabsTrigger value="niches">Niches</TabsTrigger>
          <TabsTrigger value="icps">ICPs</TabsTrigger>
        </TabsList>

        <TabsContent value="wedge" className="mt-0">
          <WedgeChart
            niches={niches}
            totalContacts={totalContacts}
            addressedCount={addressedCount}
            unaddressedCount={unaddressedCount}
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

        <TabsContent value="niches" className="mt-0">
          <NichesTable />
        </TabsContent>

        <TabsContent value="icps" className="mt-0">
          <IcpsTable />
        </TabsContent>
      </Tabs>

      {/* Bottom row: People + History */}
      <div className="grid gap-4 md:grid-cols-2">
        <PeoplePanel
          selectedNiche={selectedNiche}
          selectedIcp={selectedIcp}
          selectedOfferings={selectedOfferings}
        />
        <HistoryPanel />
      </div>
    </div>
  );
}
