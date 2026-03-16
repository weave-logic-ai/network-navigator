"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TierBadge } from "@/components/scoring/tier-badge";
import {
  Loader2,
  Sparkles,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Building2,
  Globe,
  Users,
  DollarSign,
  X,
  Check,
  ArrowRight,
  Pencil,
} from "lucide-react";

interface ContactDetail {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  title: string | null;
  currentCompany: string | null;
  location: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string;
  connectionsCount: number | null;
  degree: number;
  tags: string[];
  notes: string | null;
  compositeScore: number | null;
  tier: string | null;
  profileImageUrl: string | null;
}

interface ScoreBreakdown {
  compositeScore: number;
  tier: string;
  persona: string | null;
  behavioralPersona: string | null;
  scoredAt: string | null;
  dimensions: Array<{
    dimension: string;
    rawValue: number;
    weightedValue: number;
    weight: number;
  }>;
}

const DIMENSION_LABELS: Record<string, string> = {
  icp_fit: "ICP Fit",
  network_hub: "Network Hub",
  relationship_strength: "Relationship",
  signal_boost: "Signal Boost",
  skills_relevance: "Skills",
  network_proximity: "Proximity",
  behavioral: "Behavioral",
  content_relevance: "Content",
  graph_centrality: "Centrality",
};

// Fields that can be enriched
const ENRICHABLE_FIELDS: Array<{
  key: keyof ContactDetail;
  label: string;
  enrichKey: string; // key used in the enrichment API
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "email", label: "Email", enrichKey: "email", icon: Mail },
  { key: "phone", label: "Phone", enrichKey: "phone", icon: Phone },
  { key: "title", label: "Job Title", enrichKey: "title", icon: Building2 },
  { key: "location", label: "Location", enrichKey: "location", icon: MapPin },
  { key: "about", label: "Bio", enrichKey: "about", icon: Globe },
  { key: "connectionsCount", label: "Connections", enrichKey: "connections_count", icon: Users },
];

// Which enrichment capabilities can fill which fields
const CAPABILITY_FIELD_MAP: Record<string, string[]> = {
  email: ["email"],
  phone: ["phone"],
  social: ["linkedin_url", "location"],
  employment: ["title", "current_company", "headline"],
  education: ["education"],
  company: ["current_company", "industry"],
  profile: ["about", "headline", "location", "connections_count", "tags"],
  skills: ["tags"],
  connections: ["connections_count"],
};

interface ProviderInfo {
  name: string;
  displayName: string;
  isActive: boolean;
  costPerLookupCents: number;
  capabilities: string[];
}

function getProvidersForField(
  field: string,
  providers: ProviderInfo[]
): Array<{ name: string; displayName: string; costCents: number }> {
  return providers
    .filter((p) => p.isActive)
    .filter((p) =>
      p.capabilities.some((cap) => (CAPABILITY_FIELD_MAP[cap] || []).includes(field))
    )
    .map((p) => ({ name: p.name, displayName: p.displayName, costCents: p.costPerLookupCents }))
    .sort((a, b) => a.costCents - b.costCents);
}

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = params.id as string;
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [scores, setScores] = useState<ScoreBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  // Review modal state — delta from dry-run enrichment
  interface ReviewField {
    field: string;
    label: string;
    oldValue: string | null;
    newValue: string;
    editValue: string; // user-editable version of newValue
    confidence: number;
    provider: string;
    selected: boolean;
    editing: boolean;
  }
  const [enrichReview, setEnrichReview] = useState<{
    fields: ReviewField[];
    totalCostCents: number;
    gatedFields: string[]; // fields PDL has but are behind Person tier paywall
  } | null>(null);
  const [applying, setApplying] = useState(false);

  const [enrichConfirm, setEnrichConfirm] = useState<{
    fields: Array<{
      enrichKey: string;
      label: string;
      currentValue: string | null;
      providers: Array<{ name: string; displayName: string; costCents: number }>;
    }>;
    // All providers that will be called by the waterfall, with cost and which fields they fill
    providerBreakdown: Array<{
      name: string;
      displayName: string;
      costCents: number;
      fields: string[];
    }>;
    totalCostCents: number;
  } | null>(null);

  const loadContact = useCallback(async () => {
    try {
      const [contactRes, scoresRes, providersRes] = await Promise.all([
        fetch(`/api/contacts/${contactId}`),
        fetch(`/api/contacts/${contactId}/scores`),
        fetch("/api/enrichment/providers"),
      ]);

      if (contactRes.ok) {
        const json = await contactRes.json();
        setContact(json.data);
      }

      if (scoresRes.ok) {
        const json = await scoresRes.json();
        setScores(json.data);
      }

      if (providersRes.ok) {
        const json = await providersRes.json();
        setProviders(json.data || []);
      }
    } catch {
      // Error state handled by null checks
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    loadContact();
  }, [loadContact]);

  function handleEnrich(_field?: string) {
    if (!contact) return;

    // Show ALL enrichable fields with their current values and which provider can fill them
    const fieldBreakdown = ENRICHABLE_FIELDS.map((f) => {
      const rawValue = contact[f.key];
      const currentValue = hasRealValue(rawValue) ? String(rawValue) : null;
      const available = getProvidersForField(f.enrichKey, providers);
      return {
        enrichKey: f.enrichKey,
        label: f.label,
        currentValue,
        providers: available,
      };
    });

    // Determine which providers will be called by the waterfall for missing fields.
    // The waterfall calls providers in priority order; each provider fills what it can.
    const missingKeys = new Set(
      fieldBreakdown.filter((f) => !f.currentValue).map((f) => f.enrichKey)
    );

    const activeProviders = providers
      .filter((p) => p.isActive)
      .sort((a, b) => {
        // Match DB priority order (linkedin=5, pdl=10, lusha=20, theirstack=30, apollo=40)
        const priorityMap: Record<string, number> = { linkedin: 5, pdl: 10, lusha: 20, theirstack: 30, apollo: 40 };
        return (priorityMap[a.name] ?? 50) - (priorityMap[b.name] ?? 50);
      });

    const providerBreakdown: Array<{
      name: string; displayName: string; costCents: number; fields: string[];
    }> = [];
    const filled = new Set<string>();

    for (const p of activeProviders) {
      const canFill = [...missingKeys].filter(
        (ek) =>
          !filled.has(ek) &&
          p.capabilities.some((cap) => (CAPABILITY_FIELD_MAP[cap] || []).includes(ek))
      );
      if (canFill.length > 0) {
        providerBreakdown.push({
          name: p.name,
          displayName: p.displayName,
          costCents: p.costPerLookupCents,
          fields: canFill,
        });
        for (const f of canFill) filled.add(f);
      }
    }

    const totalCost = providerBreakdown.reduce((sum, p) => sum + p.costCents, 0);

    setEnrichConfirm({
      fields: fieldBreakdown,
      providerBreakdown,
      totalCostCents: totalCost,
    });
  }

  async function doEnrich() {
    if (!enrichConfirm) return;
    setEnrichConfirm(null);
    setEnriching("all");
    setEnrichResult(null);
    try {
      // Dry-run: fetch ALL enrichment data without writing to DB.
      // No targetFields filter — PDL charges per lookup and returns everything,
      // so we fetch all fields and let the review modal handle selection.
      const res = await fetch("/api/enrichment/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          dryRun: true,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const result = json.data?.[0];
        const delta: Array<{
          field: string; label: string; oldValue: string | null;
          newValue: string | null; confidence: number; provider: string; selected: boolean;
        }> = result?.delta || [];
        const totalCost = result?.totalCostCents ?? 0;
        const gatedFields: string[] = result?.gatedFields || [];

        // Map raw PDL field names to our enrichment field names for display
        const gatedEnrichFields = new Set<string>();
        const gatedKeyMap: Record<string, string> = {
          work_email: "email", personal_emails: "email", recommended_personal_email: "email", emails: "email",
          mobile_phone: "phone", phone_numbers: "phone",
          location_name: "location", location_locality: "location", location_region: "location",
        };
        for (const g of gatedFields) {
          const mapped = gatedKeyMap[g];
          if (mapped) gatedEnrichFields.add(mapped);
        }

        if (delta.length === 0 && gatedEnrichFields.size === 0) {
          setEnrichResult("No new data found from enrichment providers");
        } else if (delta.length === 0 && gatedEnrichFields.size > 0) {
          setEnrichResult(
            `PDL has data for ${[...gatedEnrichFields].join(", ")} but it requires the Person tier (upgrade from Starter). No fields to apply.`
          );
        } else {
          // Open review modal with editable fields
          setEnrichReview({
            fields: delta
              .filter((d) => d.newValue !== null)
              .map((d) => ({
                ...d,
                newValue: d.newValue!,
                editValue: d.newValue!,
                editing: false,
              })),
            totalCostCents: totalCost,
            gatedFields: [...gatedEnrichFields],
          });
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setEnrichResult(
          `Enrichment failed: ${(err as Record<string, string>).error || "Unknown error"}`
        );
      }
    } catch {
      setEnrichResult("Enrichment request failed");
    } finally {
      setEnriching(null);
    }
  }

  async function applyEnrichment() {
    if (!enrichReview) return;
    const selected = enrichReview.fields.filter((f) => f.selected);
    if (selected.length === 0) {
      setEnrichReview(null);
      return;
    }

    setApplying(true);
    try {
      const res = await fetch("/api/enrichment/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          fields: selected.map((f) => ({
            field: f.field,
            value: f.editValue,
          })),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const applied = json.data?.fieldsApplied ?? 0;
        setEnrichResult(`Applied ${applied} field${applied !== 1 ? "s" : ""}`);
        await loadContact();
      } else {
        const err = await res.json().catch(() => ({}));
        setEnrichResult(`Apply failed: ${(err as Record<string, string>).error || "Unknown error"}`);
      }
    } catch {
      setEnrichResult("Apply request failed");
    } finally {
      setApplying(false);
      setEnrichReview(null);
    }
  }

  function toggleReviewField(field: string) {
    setEnrichReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) =>
          f.field === field ? { ...f, selected: !f.selected } : f
        ),
      };
    });
  }

  function setReviewEditing(field: string, editing: boolean) {
    setEnrichReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) =>
          f.field === field ? { ...f, editing } : f
        ),
      };
    });
  }

  function setReviewEditValue(field: string, value: string) {
    setEnrichReview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) =>
          f.field === field ? { ...f, editValue: value } : f
        ),
      };
    });
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading..." showBack />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading contact details...
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div>
        <PageHeader title="Contact Not Found" showBack />
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Contact not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName =
    contact.fullName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    "Unknown";

  const EMPTY_SENTINELS = new Set(["true", "false", "null", "undefined", "N/A", "n/a", ""]);
  const hasRealValue = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && EMPTY_SENTINELS.has(v.trim())) return false;
    return true;
  };

  const missingFields = ENRICHABLE_FIELDS.filter(
    (f) => !hasRealValue(contact[f.key])
  );

  return (
    <div>
      <PageHeader
        title={displayName}
        showBack
        actions={
          <div className="flex items-center gap-2">
            <TierBadge
              tier={contact.tier}
              score={contact.compositeScore}
              showScore
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEnrich()}
              disabled={enriching !== null}
            >
              {enriching === "all" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              Enrich
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <p className="text-sm text-muted-foreground">
          {contact.headline || [contact.title, contact.currentCompany].filter(Boolean).join(" at ")}
        </p>
        {contact.location && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {contact.location}
          </p>
        )}
        {contact.linkedinUrl && (
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            LinkedIn Profile
          </a>
        )}
      </div>

      {enrichResult && (
        <div
          className={`rounded-md px-3 py-2 text-sm mb-4 ${
            enrichResult.includes("failed")
              ? "bg-destructive/10 text-destructive"
              : "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200"
          }`}
        >
          {enrichResult}
        </div>
      )}

      {enrichConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-orange-500" />
                Confirm Enrichment
              </h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEnrichConfirm(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Field-by-field breakdown */}
            <div className="rounded-md border divide-y text-sm mb-3">
              <div className="grid grid-cols-3 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50">
                <span>Field</span>
                <span>Current Value</span>
                <span className="text-right">Provider</span>
              </div>
              {enrichConfirm.fields.map((f) => (
                <div key={f.enrichKey} className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                  <span className="text-sm">{f.label}</span>
                  <span className={`text-xs truncate ${f.currentValue ? "text-green-600" : "text-orange-500"}`}>
                    {f.currentValue || "missing"}
                  </span>
                  <span className="text-xs text-right text-muted-foreground">
                    {f.currentValue
                      ? "skip"
                      : f.providers.length > 0
                        ? f.providers[0].displayName
                        : "no provider"}
                  </span>
                </div>
              ))}
            </div>

            {/* Provider breakdown — which providers will be called and what they cost */}
            <div className="rounded-md border divide-y text-sm mb-3">
              <div className="grid grid-cols-3 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50">
                <span>Provider</span>
                <span>Fields</span>
                <span className="text-right">Cost</span>
              </div>
              {enrichConfirm.providerBreakdown.map((p) => (
                <div key={p.name} className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                  <span className="text-sm font-medium">{p.displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">{p.fields.join(", ")}</span>
                  <span className="text-sm text-right font-medium">
                    {p.costCents === 0 ? "free" : `$${(p.costCents / 100).toFixed(2)}`}
                  </span>
                </div>
              ))}
              {enrichConfirm.providerBreakdown.length > 1 && (
                <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center bg-muted/30">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-xs text-muted-foreground">
                    {enrichConfirm.fields.filter((f) => !f.currentValue).length} fields
                  </span>
                  <span className="text-sm text-right font-semibold">
                    ${(enrichConfirm.totalCostCents / 100).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              The waterfall calls providers in order until all fields are filled.
              You&apos;ll review results before anything is saved.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEnrichConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => doEnrich()}
                disabled={enrichConfirm.fields.every((f) => !!f.currentValue)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Enrich (${(enrichConfirm.totalCostCents / 100).toFixed(2)})
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Enrichment results review modal */}
      {enrichReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg mx-4 p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Review Enrichment Results
              </h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEnrichReview(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mb-3">
              Select which fields to apply. You can edit values before saving.
              Cost: ${(enrichReview.totalCostCents / 100).toFixed(2)}
            </p>

            <div className="rounded-md border divide-y text-sm overflow-y-auto flex-1 mb-4">
              {enrichReview.fields.map((f) => (
                <div key={f.field} className="px-3 py-2.5 space-y-1">
                  {/* Row 1: checkbox, label, provider badge */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center ${
                        f.selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                      onClick={() => toggleReviewField(f.field)}
                    >
                      {f.selected && <Check className="h-3 w-3" />}
                    </button>
                    <span className="font-medium text-sm flex-1">{f.label}</span>
                    <span className="text-xs text-muted-foreground">{f.provider}</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(f.confidence * 100)}%
                    </span>
                  </div>

                  {/* Row 2: old value → new value (editable) */}
                  <div className="flex items-center gap-2 pl-6 text-xs">
                    <span className={`truncate max-w-[120px] ${f.oldValue ? "text-muted-foreground" : "text-orange-500 italic"}`}>
                      {f.oldValue || "empty"}
                    </span>
                    <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    {f.editing ? (
                      <input
                        type="text"
                        className="flex-1 border rounded px-1.5 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        value={f.editValue}
                        onChange={(e) => setReviewEditValue(f.field, e.target.value)}
                        onBlur={() => setReviewEditing(f.field, false)}
                        onKeyDown={(e) => { if (e.key === "Enter") setReviewEditing(f.field, false); }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`flex-1 truncate ${
                          f.oldValue && f.oldValue !== f.editValue
                            ? "text-blue-600 font-medium"
                            : "text-green-600 font-medium"
                        }`}
                      >
                        {f.editValue}
                      </span>
                    )}
                    {!f.editing && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        onClick={() => setReviewEditing(f.field, true)}
                        title="Edit value"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Overwrite warning */}
                  {f.oldValue && f.selected && (
                    <p className="text-xs text-orange-500 pl-6">
                      Will overwrite existing value
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Gated fields notice */}
            {enrichReview.gatedFields.length > 0 && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 mb-4">
                <strong>PDL Starter tier:</strong> PDL has <strong>{enrichReview.gatedFields.join(", ")}</strong> data
                for this person but your plan only returns true/false flags.
                Upgrade to Person tier ($110/mo for 200 lookups) to get actual values.
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => {
                  setEnrichReview((prev) => {
                    if (!prev) return prev;
                    const allSelected = prev.fields.every((f) => f.selected);
                    return {
                      ...prev,
                      fields: prev.fields.map((f) => ({ ...f, selected: !allSelected })),
                    };
                  });
                }}
              >
                {enrichReview.fields.every((f) => f.selected) ? "Deselect all" : "Select all"}
              </button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEnrichReview(null)}>
                  Skip
                </Button>
                <Button
                  size="sm"
                  onClick={applyEnrichment}
                  disabled={applying || enrichReview.fields.every((f) => !f.selected)}
                >
                  {applying ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Apply {enrichReview.fields.filter((f) => f.selected).length} field{enrichReview.fields.filter((f) => f.selected).length !== 1 ? "s" : ""}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Contact Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <EnrichableField
                  label="Email"
                  value={contact.email}
                  fieldKey="email"
                  icon={Mail}
                  enriching={enriching}
                  onEnrich={handleEnrich}
                />
                <EnrichableField
                  label="Phone"
                  value={contact.phone}
                  fieldKey="phone"
                  icon={Phone}
                  enriching={enriching}
                  onEnrich={handleEnrich}
                />
                <InfoRow
                  label="LinkedIn"
                  value={contact.linkedinUrl}
                  isLink
                />
                <InfoRow
                  label="Degree"
                  value={`${contact.degree}${ordinalSuffix(contact.degree)}`}
                />
                <EnrichableField
                  label="Connections"
                  value={
                    contact.connectionsCount
                      ? contact.connectionsCount.toLocaleString()
                      : null
                  }
                  fieldKey="connectionsCount"
                  icon={Users}
                  enriching={enriching}
                  onEnrich={handleEnrich}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  About
                  {!contact.about && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => handleEnrich("about")}
                      disabled={enriching !== null}
                    >
                      {enriching === "about" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3 mr-1" />
                      )}
                      Enrich
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contact.about ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {contact.about}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No bio available
                  </p>
                )}
                {contact.tags && contact.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {contact.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Network Position</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {contact.degree === 1
                  ? "1st degree connection"
                  : `${contact.degree}${ordinalSuffix(contact.degree)} degree`}
                {contact.connectionsCount
                  ? ` with ${contact.connectionsCount.toLocaleString()} connections`
                  : ""}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scores" className="mt-4">
          {scores ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Score Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Composite: {(scores.compositeScore * 100).toFixed(1)}%
                    </span>
                    <TierBadge tier={scores.tier} />
                  </div>
                  {scores.dimensions.map((dim) => (
                    <div key={dim.dimension} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>
                          {DIMENSION_LABELS[dim.dimension] || dim.dimension}
                        </span>
                        <span className="text-muted-foreground">
                          {(dim.rawValue * 100).toFixed(0)}% (w:{" "}
                          {(dim.weight * 100).toFixed(0)}%)
                        </span>
                      </div>
                      <Progress value={dim.rawValue * 100} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Classification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Persona" value={scores.persona} />
                  <InfoRow label="Behavioral" value={scores.behavioralPersona} />
                  <InfoRow
                    label="Scored"
                    value={
                      scores.scoredAt
                        ? new Date(scores.scoredAt).toLocaleDateString()
                        : null
                    }
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  No scores computed yet. Run scoring to see the breakdown.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="enrichment" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  Enrichment Status
                  <Button
                    size="sm"
                    onClick={() => handleEnrich()}
                    disabled={enriching !== null}
                  >
                    {enriching === "all" ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Enrich All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ENRICHABLE_FIELDS.map(({ key, label, icon: Icon }) => {
                  const value = contact[key];
                  const filled = hasRealValue(value);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">{label}</span>
                      </div>
                      {filled ? (
                        <span className="font-medium text-green-600 text-xs">
                          Available
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => handleEnrich(key)}
                          disabled={enriching !== null}
                        >
                          {enriching === key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 mr-1" />
                              Enrich
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {missingFields.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p className="text-sm font-medium text-green-700">
                    Fully enriched
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All enrichable fields have data
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Missing Data</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    {missingFields.length} field
                    {missingFields.length !== 1 ? "s" : ""} can be enriched:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {missingFields.map(({ key, label }) => (
                      <Badge key={key} variant="outline" className="text-xs">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No activity recorded yet
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EnrichableField({
  label,
  value,
  fieldKey,
  icon: Icon,
  enriching,
  onEnrich,
}: {
  label: string;
  value: string | null;
  fieldKey: string;
  icon: React.ComponentType<{ className?: string }>;
  enriching: string | null;
  onEnrich: (field: string) => void;
}) {
  const SENTINELS = new Set(["true", "false", "null", "undefined", "N/A", "n/a", ""]);
  const isReal = value !== null && !SENTINELS.has(value.trim());

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {isReal ? (
        <span className="font-medium truncate max-w-[200px]">{value}</span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-primary"
          onClick={() => onEnrich(fieldKey)}
          disabled={enriching !== null}
        >
          {enriching === fieldKey ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <Sparkles className="h-3 w-3 mr-1" />
              Enrich
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  isLink,
}: {
  label: string;
  value: string | null;
  isLink?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value ? (
        isLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline truncate max-w-[200px] text-xs"
          >
            {value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        ) : (
          <span className="font-medium">{value}</span>
        )
      ) : (
        <span className="text-muted-foreground">N/A</span>
      )}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
