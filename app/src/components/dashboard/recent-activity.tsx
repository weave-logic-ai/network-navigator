"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ActivityItem {
  type: string;
  message: string;
  timestamp: string;
}

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Check for recent import sessions
        const importRes = await fetch("/api/import/history?limit=5");
        if (importRes.ok) {
          const json = await importRes.json();
          const items: ActivityItem[] = (json.data || []).map(
            (session: { status: string; created_at: string; total_records: number }) => ({
              type: "import",
              message: `Import ${session.status}: ${session.total_records} records`,
              timestamp: session.created_at,
            })
          );
          setActivities(items);
        }
      } catch {
        // Empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : activities.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            No recent activity
          </div>
        ) : (
          <div className="space-y-2">
            {activities.map((activity, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs"
              >
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground">{activity.message}</p>
                  <p className="text-muted-foreground">
                    {new Date(activity.timestamp).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
