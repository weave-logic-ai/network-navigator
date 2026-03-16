"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, Users } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  gold: "#eab308",
  silver: "#9ca3af",
  bronze: "#f97316",
  watch: "#3b82f6",
  unscored: "#6b7280",
};

interface NicheData {
  name: string;
  contactCount: number;
  avgScore: number;
  tierBreakdown: Record<string, number>;
  topContacts: Array<{ id: string; name: string; score: number; tier: string }>;
}

interface NichePanelProps {
  niches: NicheData[];
  selectedNiche: string | null;
  onNicheSelect: (name: string | null) => void;
  onGrow: () => void;
  onShrink: () => void;
}

export function NichePanel({
  niches,
  selectedNiche,
  onNicheSelect,
  onGrow,
  onShrink,
}: NichePanelProps) {
  const selected = niches.find((n) => n.name === selectedNiche);
  const totalInNiche = selected?.contactCount ?? 0;
  const tierEntries = selected
    ? Object.entries(selected.tierBreakdown).filter(([, v]) => v > 0)
    : [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          Niches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={selectedNiche ?? "all"}
          onValueChange={(v) => onNicheSelect(v === "all" ? null : v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="All niches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
            {niches.map((n) => (
              <SelectItem key={n.name} value={n.name}>
                {n.name} ({n.contactCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Contacts</span>
                <span className="font-medium">{totalInNiche}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Avg Score</span>
                <span className="font-medium">{selected.avgScore.toFixed(1)}</span>
              </div>
            </div>

            {tierEntries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Tier Distribution</p>
                <div className="flex h-2 rounded-full overflow-hidden">
                  {tierEntries.map(([tier, count]) => (
                    <div
                      key={tier}
                      style={{
                        width: `${(count / totalInNiche) * 100}%`,
                        backgroundColor: TIER_COLORS[tier] || TIER_COLORS.unscored,
                      }}
                      title={`${tier}: ${count}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {tierEntries.map(([tier, count]) => (
                    <Badge
                      key={tier}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                      style={{ borderColor: TIER_COLORS[tier] }}
                    >
                      {tier} {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {selected.topContacts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Top Contacts</p>
                <div className="space-y-1">
                  {selected.topContacts.slice(0, 3).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-xs">
                      <span className="truncate mr-2">{c.name}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 shrink-0"
                        style={{ borderColor: TIER_COLORS[c.tier] || TIER_COLORS.unscored }}
                      >
                        {c.score > 0 ? c.score.toFixed(0) : c.tier}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={onGrow}
              >
                <ChevronUp className="h-3 w-3 mr-1" />
                Grow
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={onShrink}
              >
                <ChevronDown className="h-3 w-3 mr-1" />
                Shrink
              </Button>
            </div>
          </>
        )}

        {!selected && niches.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Select a niche to see details and controls.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
