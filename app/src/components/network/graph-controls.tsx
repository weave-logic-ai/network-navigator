"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type {
  LayoutMode,
  ColorByMode,
  SizeByMode,
  EdgeFilterMode,
} from "./network-graph";

interface GraphControlsProps {
  layout: LayoutMode;
  colorBy: ColorByMode;
  sizeBy: SizeByMode;
  edgeFilter: EdgeFilterMode;
  showClusters: boolean;
  onLayoutChange: (v: LayoutMode) => void;
  onColorByChange: (v: ColorByMode) => void;
  onSizeByChange: (v: SizeByMode) => void;
  onEdgeFilterChange: (v: EdgeFilterMode) => void;
  onShowClustersChange: (v: boolean) => void;
}

export function GraphControls({
  layout,
  colorBy,
  sizeBy,
  edgeFilter,
  showClusters,
  onLayoutChange,
  onColorByChange,
  onSizeByChange,
  onEdgeFilterChange,
  onShowClustersChange,
}: GraphControlsProps) {
  return (
    <Card className="w-56 shrink-0 z-10 overflow-y-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Graph Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Layout
          </label>
          <Select value={layout} onValueChange={(v) => onLayoutChange(v as LayoutMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forceDirected2d">Force Directed</SelectItem>
              <SelectItem value="circular2d">Circular</SelectItem>
              <SelectItem value="treeTd2d">Hierarchical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Color By
          </label>
          <Select value={colorBy} onValueChange={(v) => onColorByChange(v as ColorByMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tier">Tier</SelectItem>
              <SelectItem value="company">Company</SelectItem>
              <SelectItem value="persona">Persona</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Size By
          </label>
          <Select value={sizeBy} onValueChange={(v) => onSizeByChange(v as SizeByMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="connections">Connections</SelectItem>
              <SelectItem value="uniform">Uniform</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Edges
          </label>
          <Select value={edgeFilter} onValueChange={(v) => onEdgeFilterChange(v as EdgeFilterMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Show All</SelectItem>
              <SelectItem value="connections">Connections Only</SelectItem>
              <SelectItem value="messages">Messages Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Clusters
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={showClusters}
            onClick={() => onShowClustersChange(!showClusters)}
            className={`
              relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${showClusters ? "bg-primary" : "bg-input"}
            `}
          >
            <span
              className={`
                pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0
                transition-transform ${showClusters ? "translate-x-4" : "translate-x-0"}
              `}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
