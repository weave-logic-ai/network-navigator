import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const tierStyles: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
  silver:
    "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-600",
  bronze:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700",
  watch:
    "bg-muted text-muted-foreground border-muted dark:bg-muted dark:text-muted-foreground",
};

interface TierBadgeProps {
  tier: string | null | undefined;
  className?: string;
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  const normalizedTier = tier?.toLowerCase() ?? "unscored";
  const label = normalizedTier.charAt(0).toUpperCase() + normalizedTier.slice(1);
  const style = tierStyles[normalizedTier];

  return (
    <Badge
      variant={style ? "outline" : "outline"}
      className={cn("text-xs", style, className)}
    >
      {label}
    </Badge>
  );
}
