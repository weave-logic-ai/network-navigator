"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Activity,
  Sparkles,
  BarChart3,
  Download,
  Tag,
  Eye,
  MessageSquare,
  Undo2,
  FileEdit,
} from "lucide-react";

interface Observation {
  id: string;
  type: string;
  content: string | null;
  url: string | null;
  observedAt: string | null;
  source: string;
}

interface ActionEntry {
  id: string;
  type: string;
  actor: string;
  date: string;
  summary: string;
  metadata: Record<string, unknown>;
}

interface TimelineItem {
  id: string;
  kind: "observation" | "action";
  type: string;
  date: string;
  description: string;
  source?: string;
  url?: string | null;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  enrich: Sparkles,
  enrichment: Sparkles,
  enrichment_apply: Sparkles,
  score: BarChart3,
  scoring: BarChart3,
  import: Download,
  tag: Tag,
  revert: Undo2,
  update: FileEdit,
  profile_view: Eye,
  post_engagement: MessageSquare,
  comment: MessageSquare,
  connection_request: Activity,
};

function getIcon(type: string) {
  return TYPE_ICONS[type] || Activity;
}

export function ActivityTab({ contactId }: { contactId: string }) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/contacts/${contactId}/activity`);
        if (!res.ok) throw new Error("Failed to load activity data");
        const json = await res.json();
        if (!cancelled) {
          setObservations(json.data?.observations || []);
          setActions(json.data?.actions || []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contactId]);

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];

    for (const obs of observations) {
      items.push({
        id: `obs-${obs.id}`,
        kind: "observation",
        type: obs.type,
        date: obs.observedAt || "",
        description: obs.content || `${obs.type} observation`,
        source: obs.source,
        url: obs.url,
      });
    }

    for (const act of actions) {
      items.push({
        id: `act-${act.id}`,
        kind: "action",
        type: act.type,
        date: act.date,
        description: act.summary,
        source: act.actor,
      });
    }

    items.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return items;
  }, [observations, actions]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading activity...
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
          <Activity className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activity recorded yet. Enrich or score this contact to see
            activity.
          </p>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
            {timeline.map((item) => {
              const Icon = getIcon(item.type);
              return (
                <div key={item.id} className="relative flex gap-3 py-2.5">
                  <div className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border bg-background">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.date && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      {item.source && (
                        <span className="text-xs text-muted-foreground">
                          via {item.source}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
