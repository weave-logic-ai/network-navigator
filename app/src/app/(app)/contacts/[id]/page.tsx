"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TierBadge } from "@/components/scoring/tier-badge";

interface ContactDetail {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  title: string | null;
  current_company: string | null;
  location: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string;
  connections_count: number | null;
  degree: number;
  tags: string[];
  notes: string | null;
  composite_score: number | null;
  tier: string | null;
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

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = params.id as string;
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [scores, setScores] = useState<ScoreBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [contactRes, scoresRes] = await Promise.all([
          fetch(`/api/contacts/${contactId}`),
          fetch(`/api/contacts/${contactId}/scores`),
        ]);

        if (contactRes.ok) {
          const json = await contactRes.json();
          setContact(json.data);
        }

        if (scoresRes.ok) {
          const json = await scoresRes.json();
          setScores(json.data);
        }
      } catch {
        // Error state handled by null checks
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [contactId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Loading..." showBack />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
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

  return (
    <div>
      <PageHeader
        title={contact.full_name || "Unknown Contact"}
        showBack
        actions={
          <TierBadge tier={contact.tier} score={contact.composite_score} showScore />
        }
      />

      <div className="mb-4">
        <p className="text-sm text-muted-foreground">
          {contact.title}
          {contact.title && contact.current_company && " at "}
          {contact.current_company}
        </p>
        {contact.location && (
          <p className="text-xs text-muted-foreground mt-1">
            {contact.location}
          </p>
        )}
      </div>

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
              <CardContent className="space-y-2">
                <InfoRow label="Email" value={contact.email} />
                <InfoRow label="Phone" value={contact.phone} />
                <InfoRow label="LinkedIn" value={contact.linkedin_url} />
                <InfoRow label="Degree" value={`${contact.degree}${ordinalSuffix(contact.degree)}`} />
                <InfoRow
                  label="Connections"
                  value={contact.connections_count?.toLocaleString() || null}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">About</CardTitle>
              </CardHeader>
              <CardContent>
                {contact.about ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {contact.about}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No bio available</p>
                )}
                {contact.tags.length > 0 && (
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
                {contact.degree === 1 ? "1st degree connection" : `${contact.degree}${ordinalSuffix(contact.degree)} degree`}
                {contact.connections_count
                  ? ` with ${contact.connections_count.toLocaleString()} connections`
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
                        <span>{DIMENSION_LABELS[dim.dimension] || dim.dimension}</span>
                        <span className="text-muted-foreground">
                          {(dim.rawValue * 100).toFixed(0)}% (w: {(dim.weight * 100).toFixed(0)}%)
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
                    value={scores.scoredAt ? new Date(scores.scoredAt).toLocaleDateString() : null}
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
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Enrichment History</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {contact.email || contact.phone
                  ? "Contact has been enriched"
                  : "No enrichment data yet"}
              </p>
            </CardContent>
          </Card>
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

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={value ? "font-medium" : "text-muted-foreground"}>
        {value || "N/A"}
      </span>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
