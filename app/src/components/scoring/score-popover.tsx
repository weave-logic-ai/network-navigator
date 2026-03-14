"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";

interface DimensionBreakdown {
  dimension: string;
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
    return () => { cancelled = true; };
  }, [contactId]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="w-64 p-3" side="right">
          {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
          {!loading && !data && (
            <p className="text-xs text-muted-foreground">No score data</p>
          )}
          {data && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  Score: {(data.compositeScore * 100).toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {data.tier}
                </span>
              </div>
              {data.persona && (
                <p className="text-xs text-muted-foreground capitalize">
                  {data.persona}
                </p>
              )}
              <div className="space-y-1.5">
                {data.dimensions.map((dim) => (
                  <div key={dim.dimension} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span>
                        {DIMENSION_LABELS[dim.dimension] || dim.dimension}
                      </span>
                      <span className="text-muted-foreground">
                        {(dim.rawValue * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={dim.rawValue * 100} className="h-1" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
