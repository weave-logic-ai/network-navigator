"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TIER_DESCRIPTIONS } from "@/lib/scoring/score-descriptions";

const TIER_COLORS: Record<string, string> = {
  gold: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  silver: "bg-gray-400/20 text-gray-600 border-gray-400/30",
  bronze: "bg-orange-500/20 text-orange-700 border-orange-500/30",
  watch: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  unscored: "bg-muted text-muted-foreground border-muted",
  "gold-referral": "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  "silver-referral": "bg-gray-400/20 text-gray-600 border-gray-400/30",
  "bronze-referral": "bg-orange-500/20 text-orange-700 border-orange-500/30",
  "watch-referral": "bg-blue-500/20 text-blue-600 border-blue-500/30",
};

function tierLabel(tier: string): string {
  if (tier.endsWith("-referral")) {
    return tier.replace("-referral", "").charAt(0).toUpperCase() +
      tier.replace("-referral", "").slice(1) + " R";
  }
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

interface TierBadgeProps {
  tier: string | null;
  score?: number | null;
  showScore?: boolean;
}

export function TierBadge({ tier, score, showScore = false }: TierBadgeProps) {
  const displayTier = tier || "unscored";
  const colorClass = TIER_COLORS[displayTier] || TIER_COLORS.unscored;
  const description = TIER_DESCRIPTIONS[displayTier];

  const badge = (
    <Badge className={colorClass} variant="outline">
      {tierLabel(displayTier)}
      {showScore && score != null && (
        <span className="ml-1 opacity-75">
          {(score * 100).toFixed(0)}
        </span>
      )}
    </Badge>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-64">
          {score != null && (
            <p className="text-xs">Score: {(score * 100).toFixed(1)}%</p>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
