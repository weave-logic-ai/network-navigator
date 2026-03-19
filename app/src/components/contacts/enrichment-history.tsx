"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";

interface EnrichmentHistoryEntry {
  id: string;
  provider: string;
  providerDisplayName: string;
  date: string;
  fieldsReturned: string[];
  costCents: number;
  status: string;
  confidence: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cached: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  rate_limited: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

export function EnrichmentHistory({ contactId }: { contactId: string }) {
  const [history, setHistory] = useState<EnrichmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/contacts/${contactId}/enrichment-history`);
        if (!res.ok) throw new Error("Failed to load enrichment history");
        const json = await res.json();
        if (!cancelled) setHistory(json.data?.history || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contactId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading enrichment history...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          Enrichment History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No enrichment history yet.
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="border rounded-md px-3 py-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {entry.providerDisplayName}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-xs ${STATUS_STYLES[entry.status] || ""}`}
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {entry.costCents > 0 && (
                      <span>${(entry.costCents / 100).toFixed(2)}</span>
                    )}
                    <span>
                      {new Date(entry.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                {entry.fieldsReturned.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entry.fieldsReturned.map((field) => (
                      <Badge key={field} variant="secondary" className="text-xs">
                        {field}
                      </Badge>
                    ))}
                  </div>
                )}
                {entry.confidence !== null && (
                  <p className="text-xs text-muted-foreground">
                    Confidence: {Math.round(entry.confidence * 100)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
