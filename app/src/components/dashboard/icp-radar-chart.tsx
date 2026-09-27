"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Crosshair } from "lucide-react";
import type { IcpProfile } from "@/lib/scoring/types";

const CRITERIA: { label: string; field: keyof IcpProfile["criteria"] }[] = [
  { label: "Roles", field: "roles" },
  { label: "Industries", field: "industries" },
  { label: "Signals", field: "signals" },
  { label: "Company sizes", field: "companySizeRanges" },
  { label: "Locations", field: "locations" },
];

export function IcpRadarChart() {
  const [profile, setProfile] = useState<IcpProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/icp/profiles");
        if (res.ok) {
          const json: { data?: IcpProfile[] } = await res.json();
          setProfile(json.data?.find((item) => item.isActive) ?? null);
        }
      } catch {
        // The card shows its empty state when the API is unavailable.
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">ICP Criteria</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : !profile ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Crosshair className="h-8 w-8 opacity-40" />
            <span>Create an ICP to see its criteria</span>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{profile.name}</p>
            {CRITERIA.map(({ label, field }) => {
              const values = profile.criteria[field];
              if (!Array.isArray(values) || values.length === 0) return null;
              return (
                <div key={field}>
                  <span className="text-muted-foreground">{label}: </span>
                  <span>{values.slice(0, 3).join(", ")}{values.length > 3 ? " +" + (values.length - 3) : ""}</span>
                </div>
              );
            })}
            {typeof profile.criteria.minConnections === "number" && (
              <div>
                <span className="text-muted-foreground">Minimum connections: </span>
                <span>{profile.criteria.minConnections}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
