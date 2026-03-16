"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Crosshair, Users2, Globe } from "lucide-react";

interface IcpData {
  id: string;
  name: string;
  matchCount: number;
  firstDegreeCount: number;
  secondDegreeCount: number;
  criteria: Record<string, unknown>;
}

interface IcpPanelProps {
  icps: IcpData[];
  selectedIcp: string | null;
  onIcpSelect: (id: string | null) => void;
  showNetwork: "all" | "first" | "second";
  onNetworkToggle: (mode: "all" | "first" | "second") => void;
}

export function IcpPanel({
  icps,
  selectedIcp,
  onIcpSelect,
  showNetwork,
  onNetworkToggle,
}: IcpPanelProps) {
  const selected = icps.find((icp) => icp.id === selectedIcp);

  const criteriaEntries = selected
    ? Object.entries(selected.criteria).filter(
        ([, v]) =>
          (Array.isArray(v) && v.length > 0) ||
          (typeof v === "number" && v > 0)
      )
    : [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Crosshair className="h-4 w-4" />
          ICP Profiles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={selectedIcp ?? "all"}
          onValueChange={(v) => onIcpSelect(v === "all" ? null : v)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="All ICPs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ICPs</SelectItem>
            {icps.map((icp) => (
              <SelectItem key={icp.id} value={icp.id}>
                {icp.name} ({icp.matchCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Matches</span>
                <span className="font-medium">{selected.matchCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Users2 className="h-3 w-3" /> 1st Degree
                </span>
                <span className="font-medium">{selected.firstDegreeCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3" /> 2nd+ Degree
                </span>
                <span className="font-medium">{selected.secondDegreeCount}</span>
              </div>
            </div>

            {criteriaEntries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Criteria</p>
                <div className="space-y-1">
                  {criteriaEntries.map(([key, val]) => (
                    <div key={key}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {Array.isArray(val) ? (
                          val.map((v: string) => (
                            <Badge key={v} variant="outline" className="text-[10px] px-1.5 py-0">
                              {v}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {String(val)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Network Filter</p>
              <div className="flex gap-1">
                {(["all", "first", "second"] as const).map((mode) => (
                  <Badge
                    key={mode}
                    variant={showNetwork === mode ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() => onNetworkToggle(mode)}
                  >
                    {mode === "all" ? "All" : mode === "first" ? "1st" : "2nd+"}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {!selected && icps.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No ICP profiles yet. Use the ICP Builder tab to create one.
          </p>
        )}

        {!selected && icps.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Select an ICP to see match details and criteria.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
