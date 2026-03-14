"use client";

import { Badge } from "@/components/ui/badge";

interface EnrichmentStatusBadgeProps {
  status?: string;
}

const STATUS_COLORS: Record<string, string> = {
  enriched: "bg-green-500/20 text-green-700 border-green-500/30",
  pending: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  failed: "bg-red-500/20 text-red-700 border-red-500/30",
  none: "bg-muted text-muted-foreground border-muted",
};

export function EnrichmentStatusBadge({ status }: EnrichmentStatusBadgeProps) {
  const displayStatus = status || "none";
  const colorClass = STATUS_COLORS[displayStatus] || STATUS_COLORS.none;

  return (
    <Badge className={colorClass} variant="outline">
      {displayStatus === "none"
        ? "Not Enriched"
        : displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
    </Badge>
  );
}
