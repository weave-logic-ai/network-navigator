"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertTriangle, Target, Compass } from "lucide-react";
import { DesiredIcpSelector } from "./desired-icp-selector";
import { GapSuggestions, type Suggestion } from "./gap-suggestions";

interface NaturalIcp {
  roles: string[];
  industries: string[];
  signals: string[];
  profileSignals: {
    headlineKeywords: string[];
    skillSignals: string[];
    positionIndustries: string[];
    aboutThemes: string[];
  };
  networkSignals: {
    topRoles: Array<{ role: string; count: number }>;
    topIndustries: Array<{ industry: string; count: number }>;
    topNiches: Array<{ niche: string; count: number }>;
  };
  computedAt: string;
}

interface GapAnalysis {
  alignmentScore: number;
  gaps: {
    missingIndustries: string[];
    missingRoles: string[];
    missingSignals: string[];
    missingNicheKeywords: string[];
    companySizeMismatch: boolean;
  };
  strengths: {
    sharedIndustries: string[];
    sharedRoles: string[];
    sharedSignals: string[];
    nicheContactCount: number;
  };
  suggestions: Suggestion[];
}

export function IcpAlignment() {
  const [naturalIcp, setNaturalIcp] = useState<NaturalIcp | null>(null);
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [naturalRes, gapRes] = await Promise.all([
        fetch("/api/profile/natural-icp"),
        fetch("/api/profile/gap-analysis"),
      ]);

      if (naturalRes.ok) {
        const json = await naturalRes.json();
        setNaturalIcp(json.data);
      }
      if (gapRes.ok) {
        const json = await gapRes.json();
        setGapAnalysis(json.data);
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

  function handleDesiredIcpSaved() {
    // Re-fetch gap analysis when desired ICP is saved
    loadData();
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-sm text-muted-foreground">
            Computing ICP alignment...
          </span>
        </CardContent>
      </Card>
    );
  }

  const hasGaps =
    gapAnalysis &&
    (gapAnalysis.gaps.missingIndustries.length > 0 ||
      gapAnalysis.gaps.missingSignals.length > 0 ||
      gapAnalysis.gaps.missingNicheKeywords.length > 0);

  const allGapItems = [
    ...gapAnalysis?.gaps.missingNicheKeywords.map(
      (k) => `Missing "${k}" from profile`
    ) ?? [],
    ...gapAnalysis?.gaps.missingIndustries.map(
      (i) => `Not signaling "${i}" industry`
    ) ?? [],
    ...gapAnalysis?.gaps.missingSignals.map(
      (s) => `Missing "${s}" signal`
    ) ?? [],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Your ICP Alignment
          </CardTitle>
          <CardDescription>
            Compare your natural position with your desired target to find
            optimization opportunities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left: Natural ICP (computed) */}
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Compass className="h-4 w-4" />
                  Natural ICP (computed)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {naturalIcp ? (
                  <>
                    {naturalIcp.industries.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Industries
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {naturalIcp.industries.map((ind, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {ind}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {naturalIcp.roles.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Roles
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {naturalIcp.roles.slice(0, 6).map((role, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {role}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {naturalIcp.signals.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Signals
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {naturalIcp.signals.slice(0, 8).map((sig, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {sig}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {naturalIcp.networkSignals.topNiches.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Network
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {naturalIcp.networkSignals.topNiches
                            .slice(0, 4)
                            .map((n, i) => (
                              <Badge
                                key={i}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {n.niche} ({n.count})
                              </Badge>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Import your LinkedIn profile to compute your natural ICP.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Right: Desired ICP (user-selected) */}
            <DesiredIcpSelector onSaved={handleDesiredIcpSaved} />
          </div>

          {/* Alignment Score */}
          {gapAnalysis && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Alignment Score</span>
                  <span className="text-sm font-bold">
                    {gapAnalysis.alignmentScore}%
                  </span>
                </div>
                <Progress value={gapAnalysis.alignmentScore} className="h-3" />
              </div>

              {/* Gap List */}
              {hasGaps && allGapItems.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-sm font-medium">Gaps</p>
                  {allGapItems.slice(0, 6).map((gap, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                      {gap}
                    </div>
                  ))}
                </div>
              )}

              {/* Strengths */}
              {gapAnalysis.strengths.sharedSignals.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-sm font-medium">Strengths</p>
                  <div className="flex flex-wrap gap-1">
                    {gapAnalysis.strengths.sharedSignals.map((s, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="text-[10px] bg-green-50 text-green-700 border-green-200"
                      >
                        {s}
                      </Badge>
                    ))}
                  </div>
                  {gapAnalysis.strengths.nicheContactCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {gapAnalysis.strengths.nicheContactCount} contacts already
                      in target niche
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Suggestions */}
      {gapAnalysis && gapAnalysis.suggestions.length > 0 && (
        <GapSuggestions suggestions={gapAnalysis.suggestions} />
      )}
    </div>
  );
}
