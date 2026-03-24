"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TierBadge } from "@/components/scoring/tier-badge";
import {
  MapPin,
  Briefcase,
  Users,
  MessageSquare,
  ArrowRight,
  Zap,
} from "lucide-react";

interface ContactBrief {
  id: string;
  fullName: string;
  title: string | null;
  company: string | null;
  location: string | null;
  headline: string | null;
  degree: number;
  skills: string[];
  compositeScore: number | null;
  tier: string | null;
  totalMessages: number;
  sharedConnections: number;
  icpMatches: string[];
}

interface ContactTooltipProps {
  contactId: string;
  children: ReactNode;
}

function DegreeBadge({ degree }: { degree: number }) {
  const label = degree === 1 ? "1st" : degree === 2 ? "2nd" : `${degree}+`;
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 h-4 bg-muted/50"
    >
      {label}
    </Badge>
  );
}

function TooltipSkeleton() {
  return (
    <div className="w-64 space-y-2 p-1">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
      <div className="flex gap-1 pt-1">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

function TooltipBody({ data }: { data: ContactBrief }) {
  const headline =
    data.headline && data.headline.length > 80
      ? data.headline.slice(0, 80) + "..."
      : data.headline;

  return (
    <div className="w-64 space-y-2 p-1">
      {/* Name + degree */}
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-xs text-tooltip-foreground truncate">
          {data.fullName}
        </span>
        <DegreeBadge degree={data.degree} />
      </div>

      {/* Title + company */}
      {(data.title || data.company) && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Briefcase className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {data.title}
            {data.title && data.company && " at "}
            {data.company}
          </span>
        </div>
      )}

      {/* Location */}
      {data.location && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{data.location}</span>
        </div>
      )}

      {/* Headline */}
      {headline && (
        <p className="text-[11px] text-muted-foreground/80 italic leading-snug">
          {headline}
        </p>
      )}

      {/* Score + tier */}
      <div className="flex items-center gap-2 pt-0.5">
        <TierBadge tier={data.tier} score={data.compositeScore} showScore />
      </div>

      {/* Skills */}
      {data.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.skills.map((skill) => (
            <Badge
              key={skill}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4"
            >
              {skill}
            </Badge>
          ))}
        </div>
      )}

      {/* ICP signals */}
      {data.icpMatches.length > 0 && (
        <div className="flex items-start gap-1 text-[11px]">
          <Zap className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            ICP match: {data.icpMatches.join(", ")}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-0.5 border-t border-border/50">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {data.sharedConnections} connections
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          {data.totalMessages} messages
        </span>
      </div>

      {/* View profile link */}
      <Link
        href={`/contacts/${data.id}`}
        className="flex items-center gap-1 text-[11px] text-primary hover:underline pt-0.5"
      >
        View Profile
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function ContactTooltip({ contactId, children }: ContactTooltipProps) {
  const [data, setData] = useState<ContactBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBrief = useCallback(async () => {
    if (fetchedRef.current || loading) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(false);

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/contacts/${contactId}/brief`, {
        signal: abortRef.current.signal,
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      } else {
        setError(true);
        fetchedRef.current = false; // allow retry
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(true);
      fetchedRef.current = false; // allow retry
    } finally {
      setLoading(false);
    }
  }, [contactId, loading]);

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild onMouseEnter={fetchBrief}>
          {children}
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          sideOffset={8}
          className="bg-popover text-popover-foreground border shadow-lg rounded-lg p-3 max-w-72"
        >
          {loading && <TooltipSkeleton />}
          {error && !loading && (
            <p className="text-xs text-muted-foreground w-48">
              Failed to load contact info.
            </p>
          )}
          {data && !loading && <TooltipBody data={data} />}
          {!data && !loading && !error && <TooltipSkeleton />}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
