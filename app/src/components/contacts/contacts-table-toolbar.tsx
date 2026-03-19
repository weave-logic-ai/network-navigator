"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Search } from "lucide-react";
import { RescoreAllButton } from "@/components/scoring/rescore-all-button";

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tier: string;
  onTierChange: (value: string) => void;
  enrichmentStatus: string;
  onEnrichmentChange: (value: string) => void;
  onClearFilters: () => void;
}

export function ContactsTableToolbar({
  search,
  onSearchChange,
  tier,
  onTierChange,
  enrichmentStatus,
  onEnrichmentChange,
  onClearFilters,
}: ToolbarProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSearchChange(value), 300);
  };

  const activeFilterCount =
    (tier && tier !== "all" ? 1 : 0) +
    (enrichmentStatus && enrichmentStatus !== "all" ? 1 : 0) +
    (search ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-3 pb-4">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search contacts..."
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>
      <Select value={tier || "all"} onValueChange={onTierChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Tier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Tiers</SelectItem>
          <SelectItem value="gold">Gold</SelectItem>
          <SelectItem value="silver">Silver</SelectItem>
          <SelectItem value="bronze">Bronze</SelectItem>
          <SelectItem value="watch">Watch</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={enrichmentStatus || "all"}
        onValueChange={onEnrichmentChange}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Enrichment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="enriched">Enriched</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>
      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          Clear
          <Badge variant="secondary" className="ml-1">
            {activeFilterCount}
          </Badge>
          <X className="ml-1 h-3 w-3" />
        </Button>
      )}
      <div className="ml-auto">
        <RescoreAllButton />
      </div>
    </div>
  );
}
