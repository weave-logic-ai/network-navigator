"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/scoring/tier-badge";
import { contactDisplayName, hasLinkedIdentity, isSelfContact } from "@/lib/contacts/identity";

interface ContactSummary {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  linkedinUrl: string | null;
  currentCompany: string | null;
  compositeScore: number | null;
  tier: string | null;
}

export function TopContactsList() {
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/contacts?sort=score&order=desc&limit=20");
        if (res.ok) {
          const json = await res.json();
          setContacts((json.data || []).filter((contact: ContactSummary) => !isSelfContact(contact)).slice(0, 10));
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
        <CardTitle className="text-sm font-medium">
          {contacts.some((contact) => hasLinkedIdentity(contact) && contact.compositeScore !== null)
            ? "Top Contacts"
            : "Contacts"}
        </CardTitle>
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
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {contactDisplayName(contact) ?? "Identify contact"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {hasLinkedIdentity(contact)
                      ? contact.currentCompany || "View contact"
                      : "Review identity before outreach"}
                  </p>
                </div>
                {hasLinkedIdentity(contact) && (
                  <TierBadge
                    tier={contact.tier}
                    score={contact.compositeScore}
                    showScore
                  />
                )}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
