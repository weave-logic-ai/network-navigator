"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, X } from "lucide-react";

interface NicheProfile {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  memberCount: number;
}

interface IcpProfile {
  id: string;
  name: string;
  nicheId: string | null;
  description: string | null;
  criteria: Record<string, unknown>;
}

interface Offering {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface DesiredIcpConfig {
  nicheId: string | null;
  icpId: string | null;
  offeringIds: string[];
  isDefault: boolean;
  savedAt: string;
}

interface DesiredIcpSelectorProps {
  onSaved?: (config: DesiredIcpConfig) => void;
}

export function DesiredIcpSelector({ onSaved }: DesiredIcpSelectorProps) {
  const [niches, setNiches] = useState<NicheProfile[]>([]);
  const [icps, setIcps] = useState<IcpProfile[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);

  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [selectedIcp, setSelectedIcp] = useState<string | null>(null);
  const [selectedOfferings, setSelectedOfferings] = useState<string[]>([]);
  const [isDefault, setIsDefault] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [nichesRes, icpsRes, offeringsRes, configRes] = await Promise.all([
        fetch("/api/niches"),
        fetch("/api/icps"),
        fetch("/api/offerings"),
        fetch("/api/profile/desired-icp"),
      ]);

      if (nichesRes.ok) {
        const json = await nichesRes.json();
        setNiches(json.data || []);
      }
      if (icpsRes.ok) {
        const json = await icpsRes.json();
        setIcps(json.data || []);
      }
      if (offeringsRes.ok) {
        const json = await offeringsRes.json();
        setOfferings(json.data || []);
      }
      if (configRes.ok) {
        const json = await configRes.json();
        const config = json.data as DesiredIcpConfig | null;
        if (config) {
          setSelectedNiche(config.nicheId);
          setSelectedIcp(config.icpId);
          setSelectedOfferings(config.offeringIds || []);
          setIsDefault(config.isDefault);
        }
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter ICPs by selected niche
  const filteredIcps = selectedNiche
    ? icps.filter((p) => p.nicheId === selectedNiche || !p.nicheId)
    : icps;

  function toggleOffering(id: string) {
    setSelectedOfferings((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setSaving(true);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/profile/desired-icp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nicheId: selectedNiche,
          icpId: selectedIcp,
          offeringIds: selectedOfferings,
          isDefault,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setSavedMessage("Saved");
        setTimeout(() => setSavedMessage(null), 3000);
        onSaved?.(json.data);
      }
    } catch {
      // Silent
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Desired ICP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Niche selector */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Target Niche
          </label>
          <Select
            value={selectedNiche ?? "none"}
            onValueChange={(v) => {
              setSelectedNiche(v === "none" ? null : v);
              // Reset ICP when niche changes
              setSelectedIcp(null);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a niche..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No niche selected</SelectItem>
              {niches.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ICP selector */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Target ICP
          </label>
          <Select
            value={selectedIcp ?? "none"}
            onValueChange={(v) => setSelectedIcp(v === "none" ? null : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select an ICP..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No ICP selected</SelectItem>
              {filteredIcps.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Offerings multi-select */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Offerings
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 min-h-[32px]">
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
                <SelectValue placeholder="Add..." />
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
          </div>
        </div>

        {/* Show on Discover toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Show on Discover (default)
          </label>
          <Switch checked={isDefault} onCheckedChange={setIsDefault} />
        </div>

        {/* Save button */}
        <Button
          onClick={handleSave}
          disabled={saving}
          size="sm"
          className="w-full"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          {savedMessage || "Save as Default"}
        </Button>
      </CardContent>
    </Card>
  );
}
