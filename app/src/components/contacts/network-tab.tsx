"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, Building2, GitFork } from "lucide-react";

interface NetworkContact {
  id: string;
  fullName: string | null;
  headline: string | null;
  currentCompany: string | null;
  profileImageUrl: string | null;
  linkedinUrl: string;
}

interface NetworkData {
  mutualConnections: NetworkContact[];
  sameCompany: NetworkContact[];
  edgeCount: number;
}

export function NetworkTab({ contactId }: { contactId: string }) {
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/contacts/${contactId}/network`);
        if (!res.ok) throw new Error("Failed to load network data");
        const json = await res.json();
        if (!cancelled) setData(json.data);
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
          Loading network data...
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

  if (!data) return null;

  const hasNoData =
    data.mutualConnections.length === 0 &&
    data.sameCompany.length === 0 &&
    data.edgeCount === 0;

  if (hasNoData) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            No network data available. Import more connections to see network
            relationships.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            Network Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{data.edgeCount}</p>
              <p className="text-xs text-muted-foreground">Edges</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{data.mutualConnections.length}</p>
              <p className="text-xs text-muted-foreground">Mutual</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{data.sameCompany.length}</p>
              <p className="text-xs text-muted-foreground">Same Co.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Mutual Connections
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.mutualConnections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No mutual connections found.
            </p>
          ) : (
            <div className="space-y-2">
              {data.mutualConnections.map((c) => (
                <ContactRow key={c.id} contact={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Same Company
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.sameCompany.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other contacts at the same company.
            </p>
          ) : (
            <div className="space-y-2">
              {data.sameCompany.map((c) => (
                <ContactRow key={c.id} contact={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ContactRow({ contact }: { contact: NetworkContact }) {
  const name = contact.fullName || "Unknown";
  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        {contact.headline && (
          <p className="text-xs text-muted-foreground truncate">
            {contact.headline}
          </p>
        )}
      </div>
      {contact.currentCompany && (
        <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
          {contact.currentCompany}
        </Badge>
      )}
    </Link>
  );
}
