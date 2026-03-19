"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TierBadge } from "@/components/scoring/tier-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DIMENSION_LABELS,
  DIMENSION_DESCRIPTIONS,
  REFERRAL_LABELS,
  REFERRAL_DESCRIPTIONS,
  COMPOSITE_DESCRIPTION,
  REFERRAL_LIKELIHOOD_DESCRIPTION,
  PERSONA_DESCRIPTIONS,
  BEHAVIORAL_PERSONA_DESCRIPTIONS,
  REFERRAL_PERSONA_DESCRIPTIONS,
  TIER_DESCRIPTIONS,
} from "@/lib/scoring/score-descriptions";

interface DimensionBreakdown {
  dimension: string;
  rawValue: number;
  weightedValue: number;
  weight: number;
}

interface ReferralDimension {
  component: string;
  rawValue: number;
  weightedValue: number;
  weight: number;
}

interface ScoreData {
  compositeScore: number;
  tier: string;
  persona: string | null;
  behavioralPersona: string | null;
  dimensions: DimensionBreakdown[];
  referralLikelihood: number | null;
  referralTier: string | null;
  referralPersona: string | null;
  referralDimensions: ReferralDimension[] | null;
}

function scoreColor(value: number): string {
  if (value >= 0.6) return "text-emerald-600";
  if (value >= 0.3) return "text-amber-500";
  return "text-red-400";
}

function progressColor(value: number): string {
  if (value >= 60) return "[&>div]:bg-emerald-500";
  if (value >= 30) return "[&>div]:bg-amber-400";
  return "[&>div]:bg-red-400";
}

interface ContactScoreCardProps {
  contactId: string;
  onRescore?: () => void;
}

export function ContactScoreCard({
  contactId,
  onRescore,
}: ContactScoreCardProps) {
  const [data, setData] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/scores`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const handleRescore = async () => {
    setRescoring(true);
    try {
      const res = await fetch("/api/scoring/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (res.ok) {
        await load();
        onRescore?.();
      }
    } catch {
      // Silently fail
    } finally {
      setRescoring(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="h-16 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="h-16 flex items-center justify-center text-sm text-muted-foreground">
            No score data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const scorePercent = Math.round(data.compositeScore * 100);

  return (
    <Card className="overflow-hidden">
      <CardContent className="py-4 space-y-4">
        {/* Header: Score + Tier + Rescore button */}
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col items-center justify-center flex-shrink-0 cursor-help">
                  <span
                    className={`text-3xl font-bold tracking-tight ${scoreColor(data.compositeScore)}`}
                  >
                    {scorePercent}
                  </span>
                  <span className="text-xs text-muted-foreground">Score</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                <p className="text-xs">{COMPOSITE_DESCRIPTION}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <TierBadge tier={data.tier} />
              {data.persona && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground capitalize truncate cursor-help">
                        {data.persona}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      <p className="text-xs">
                        {PERSONA_DESCRIPTIONS[data.persona] || data.persona}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {data.behavioralPersona &&
                data.behavioralPersona !== "unknown" && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground/60 capitalize truncate cursor-help">
                          {data.behavioralPersona}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        <p className="text-xs">
                          {BEHAVIORAL_PERSONA_DESCRIPTIONS[
                            data.behavioralPersona
                          ] || data.behavioralPersona}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
            </div>
            <Progress
              value={scorePercent}
              className={`h-1.5 ${progressColor(scorePercent)}`}
            />
          </div>

          <button
            onClick={handleRescore}
            disabled={rescoring}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-transparent hover:border-border disabled:opacity-50"
            title="Rescore this contact"
          >
            {rescoring ? "..." : "\u21bb"}
          </button>
        </div>

        {/* Dimension Breakdown */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Dimensions
          </p>
          {data.dimensions.map((dim) => (
            <TooltipProvider key={dim.dimension}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="space-y-0.5 cursor-help">
                    <div className="flex items-center justify-between text-xs">
                      <span>
                        {DIMENSION_LABELS[dim.dimension] || dim.dimension}
                      </span>
                      <span className={scoreColor(dim.rawValue)}>
                        {(dim.rawValue * 100).toFixed(0)}%
                        <span className="text-muted-foreground ml-1">
                          w:{(dim.weight * 100).toFixed(0)}
                        </span>
                      </span>
                    </div>
                    <Progress
                      value={dim.rawValue * 100}
                      className={`h-1 ${progressColor(dim.rawValue * 100)}`}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-72">
                  <p className="text-xs font-medium mb-1">
                    {DIMENSION_LABELS[dim.dimension] || dim.dimension}
                  </p>
                  <p className="text-xs">
                    {DIMENSION_DESCRIPTIONS[dim.dimension] ||
                      "No description available."}
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground">
                    Raw: {(dim.rawValue * 100).toFixed(1)}% | Weight:{" "}
                    {(dim.weight * 100).toFixed(0)}% | Contribution:{" "}
                    {(dim.weightedValue * 100).toFixed(1)}%
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>

        {/* Referral Section */}
        {data.referralLikelihood != null && (
          <div className="border-t pt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs font-medium cursor-help">
                      Referral:{" "}
                      <span className={scoreColor(data.referralLikelihood)}>
                        {(data.referralLikelihood * 100).toFixed(0)}%
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    <p className="text-xs">{REFERRAL_LIKELIHOOD_DESCRIPTION}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex items-center gap-2">
                {data.referralTier && (
                  <TierBadge tier={data.referralTier} />
                )}
                {data.referralPersona && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground capitalize cursor-help">
                          {data.referralPersona}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        <p className="text-xs">
                          {REFERRAL_PERSONA_DESCRIPTIONS[
                            data.referralPersona
                          ] || data.referralPersona}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>

            {data.referralDimensions &&
              data.referralDimensions.length > 0 &&
              data.referralDimensions.map((rd) => (
                <TooltipProvider key={rd.component}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="space-y-0.5 cursor-help">
                        <div className="flex items-center justify-between text-xs">
                          <span>
                            {REFERRAL_LABELS[rd.component] || rd.component}
                          </span>
                          <span className={scoreColor(rd.rawValue)}>
                            {(rd.rawValue * 100).toFixed(0)}%
                          </span>
                        </div>
                        <Progress
                          value={rd.rawValue * 100}
                          className={`h-1 ${progressColor(rd.rawValue * 100)}`}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-72">
                      <p className="text-xs font-medium mb-1">
                        {REFERRAL_LABELS[rd.component] || rd.component}
                      </p>
                      <p className="text-xs">
                        {REFERRAL_DESCRIPTIONS[rd.component] ||
                          "No description available."}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
