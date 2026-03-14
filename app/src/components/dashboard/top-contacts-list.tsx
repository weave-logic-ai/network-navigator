"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/scoring/tier-badge";

interface ContactSummary {
  id: string;
  full_name: string | null;
  current_company: string | null;
  composite_score: number | null;
  tier: string | null;
}

export function TopContactsList() {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/contacts?sort=score&order=desc&limit=10");
        if (res.ok) {
          const json = await res.json();
          setContacts(json.data || []);
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
        <CardTitle className="text-sm font-medium">Top Contacts</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : contacts.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            No contacts yet. Import your LinkedIn data to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {contact.full_name || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {contact.current_company || ""}
                  </p>
                </div>
                <TierBadge
                  tier={contact.tier}
                  score={contact.composite_score}
                  showScore
                />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
