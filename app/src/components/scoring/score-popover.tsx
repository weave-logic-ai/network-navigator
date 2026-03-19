"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import {
  DIMENSION_LABELS,
  DIMENSION_DESCRIPTIONS,
  REFERRAL_LABELS,
  REFERRAL_DESCRIPTIONS,
  COMPOSITE_DESCRIPTION,
  REFERRAL_LIKELIHOOD_DESCRIPTION,
  PERSONA_DESCRIPTIONS,
  BEHAVIORAL_PERSONA_DESCRIPTIONS,
  TIER_DESCRIPTIONS,
  REFERRAL_PERSONA_DESCRIPTIONS,
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

interface ScoreBreakdownData {
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

interface ScorePopoverProps {
  contactId: string;
  children: React.ReactNode;
}

export function ScorePopover({ contactId, children }: ScorePopoverProps) {
  const [data, setData] = useState<ScoreBreakdownData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/scores`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json.data);
        }
      } catch {
        // Silently fail for popover
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="w-72 p-3" side="right">
          {loading && (
            <p className="text-xs text-muted-foreground">Loading...</p>
          )}
          {!loading && !data && (
            <p className="text-xs text-muted-foreground">No score data</p>
          )}
          {data && (
            <div className="space-y-2">
              {/* Composite Score */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between cursor-help">
                      <span className="text-xs font-medium">
                        Score:{" "}
                        <span className={scoreColor(data.compositeScore)}>
                          {(data.compositeScore * 100).toFixed(1)}%
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {data.tier}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64">
                    <p className="text-xs">{COMPOSITE_DESCRIPTION}</p>
                    {data.tier && (
                      <p className="text-xs mt-1 text-muted-foreground">
                        {TIER_DESCRIPTIONS[data.tier]}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Personas */}
              {data.persona && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-muted-foreground capitalize cursor-help">
                        {data.persona}
                        {data.behavioralPersona &&
                          data.behavioralPersona !== "unknown" &&
                          ` / ${data.behavioralPersona}`}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <p className="text-xs">
                        {PERSONA_DESCRIPTIONS[data.persona] || data.persona}
                      </p>
                      {data.behavioralPersona &&
                        data.behavioralPersona !== "unknown" && (
                          <p className="text-xs mt-1 text-muted-foreground">
                            {BEHAVIORAL_PERSONA_DESCRIPTIONS[
                              data.behavioralPersona
                            ] || data.behavioralPersona}
                          </p>
                        )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Dimension Breakdown */}
              <div className="space-y-1.5">
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
                                (w:{(dim.weight * 100).toFixed(0)})
                              </span>
                            </span>
                          </div>
                          <Progress
                            value={dim.rawValue * 100}
                            className={`h-1 ${progressColor(dim.rawValue * 100)}`}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-64">
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

              {/* Referral Scoring Section */}
              {data.referralLikelihood != null && (
                <>
                  <div className="border-t pt-2 mt-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between cursor-help">
                            <span className="text-xs font-medium">
                              Referral:{" "}
                              <span
                                className={scoreColor(data.referralLikelihood)}
                              >
                                {(data.referralLikelihood * 100).toFixed(1)}%
                              </span>
                            </span>
                            {data.referralTier && (
                              <span className="text-xs text-muted-foreground capitalize">
                                {data.referralTier.replace("-referral", "")}
                              </span>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64">
                          <p className="text-xs">
                            {REFERRAL_LIKELIHOOD_DESCRIPTION}
                          </p>
                          {data.referralTier && (
                            <p className="text-xs mt-1 text-muted-foreground">
                              {TIER_DESCRIPTIONS[data.referralTier]}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {data.referralPersona && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs text-muted-foreground capitalize cursor-help mt-0.5">
                              {data.referralPersona}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-64">
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

                  {/* Referral Dimensions */}
                  {data.referralDimensions &&
                    data.referralDimensions.length > 0 && (
                      <div className="space-y-1.5">
                        {data.referralDimensions.map((rd) => (
                          <TooltipProvider key={rd.component}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="space-y-0.5 cursor-help">
                                  <div className="flex items-center justify-between text-xs">
                                    <span>
                                      {REFERRAL_LABELS[rd.component] ||
                                        rd.component}
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
                              <TooltipContent
                                side="left"
                                className="max-w-64"
                              >
                                <p className="text-xs font-medium mb-1">
                                  {REFERRAL_LABELS[rd.component] ||
                                    rd.component}
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
                </>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
