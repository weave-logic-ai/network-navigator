"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TIER_COLORS: Record<string, string> = {
  gold: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  silver: "bg-gray-400/20 text-gray-600 border-gray-400/30",
  bronze: "bg-orange-500/20 text-orange-700 border-orange-500/30",
  watch: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  unscored: "bg-muted text-muted-foreground border-muted",
};

interface TierBadgeProps {
  tier: string | null;
  score?: number | null;
  showScore?: boolean;
}

export function TierBadge({ tier, score, showScore = false }: TierBadgeProps) {
  const displayTier = tier || "unscored";
  const colorClass = TIER_COLORS[displayTier] || TIER_COLORS.unscored;

  const badge = (
    <Badge className={colorClass} variant="outline">
      {displayTier.charAt(0).toUpperCase() + displayTier.slice(1)}
      {showScore && score != null && (
        <span className="ml-1 opacity-75">
          {(score * 100).toFixed(0)}
        </span>
      )}
    </Badge>
  );

  if (score == null) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <p>Score: {(score * 100).toFixed(1)}%</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
