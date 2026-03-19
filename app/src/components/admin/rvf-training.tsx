"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Equal, Trophy } from "lucide-react";

interface RvfContact {
  id: string;
  full_name: string | null;
  headline: string | null;
  current_company: string | null;
  composite_score: number | null;
  tier: string | null;
  persona: string | null;
}

interface PairResponse {
  pair: [RvfContact, RvfContact] | null;
  totalComparisons: number;
  totalContacts: number;
}

export function RvfTraining() {
  const [pair, setPair] = useState<[RvfContact, RvfContact] | null>(null);
  const [totalComparisons, setTotalComparisons] = useState(0);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchPair = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rvf");
      if (res.ok) {
        const json: PairResponse = await res.json();
        setPair(json.pair ?? null);
        setTotalComparisons(json.totalComparisons);
        setTotalContacts(json.totalContacts);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPair();
  }, [fetchPair]);

  const submitChoice = async (
    winnerId: string,
    loserId: string,
    isEqual: boolean
  ) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/rvf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId, loserId, isEqual }),
      });
      if (res.ok) {
        const json = await res.json();
        setTotalComparisons(json.totalComparisons);
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
      fetchPair();
    }
  };

  // Max possible pairs = n*(n-1)/2
  const maxPairs =
    totalContacts > 1 ? (totalContacts * (totalContacts - 1)) / 2 : 1;
  const progressPct = Math.min((totalComparisons / maxPairs) * 100, 100);

  if (loading && !pair) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading pair...</span>
      </div>
    );
  }

  if (!pair) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Need at least 2 scored contacts to begin RVF training.
          </p>
        </CardContent>
      </Card>
    );
  }

  const [a, b] = pair;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {totalComparisons} comparisons of ~{maxPairs} possible pairs
          </span>
          <span className="font-medium">{progressPct.toFixed(1)}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Which contact is more valuable to your network?
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <ContactCard
          contact={a}
          onSelect={() => submitChoice(a.id, b.id, false)}
          disabled={submitting}
        />
        <ContactCard
          contact={b}
          onSelect={() => submitChoice(b.id, a.id, false)}
          disabled={submitting}
        />
      </div>

      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => submitChoice(a.id, b.id, true)}
          disabled={submitting}
        >
          <Equal className="h-4 w-4 mr-2" />
          Equal Value
        </Button>
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  onSelect,
  disabled,
}: {
  contact: RvfContact;
  onSelect: () => void;
  disabled: boolean;
}) {
  const score = contact.composite_score;
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-primary"
      onClick={disabled ? undefined : onSelect}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="truncate">
            {contact.full_name || "Unknown"}
          </span>
          {contact.tier && (
            <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
              {contact.tier}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {contact.headline && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {contact.headline}
          </p>
        )}
        {contact.current_company && (
          <p className="text-xs text-muted-foreground">
            {contact.current_company}
          </p>
        )}
        <div className="flex items-center gap-2 pt-1">
          {score !== null && (
            <span className="text-xs font-medium">
              Score: {(score * 100).toFixed(1)}%
            </span>
          )}
          {contact.persona && (
            <Badge variant="secondary" className="text-xs">
              {contact.persona}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          className="w-full mt-2"
          variant="outline"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <Trophy className="h-3.5 w-3.5 mr-1.5" />
          More Valuable
        </Button>
      </CardContent>
    </Card>
  );
}
