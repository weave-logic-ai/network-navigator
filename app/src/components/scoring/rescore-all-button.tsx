"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { RefreshCw } from "lucide-react";

interface ScoringRunStatus {
  id: string;
  runType: string;
  status: "pending" | "running" | "completed" | "failed";
  totalContacts: number;
  scoredContacts: number;
  failedContacts: number;
  startedAt: string;
  completedAt: string | null;
}

export function RescoreAllButton() {
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScoringRunStatus | null>(null);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/scoring/status?runId=${id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setStatus(json.data);
          if (
            json.data.status === "completed" ||
            json.data.status === "failed"
          ) {
            setRunning(false);
            return; // stop polling
          }
        }
      }
    } catch {
      // continue polling
    }
    // Poll again after 2s
    setTimeout(() => pollStatus(id), 2000);
  }, []);

  useEffect(() => {
    if (runId && running) {
      const timer = setTimeout(() => pollStatus(runId), 1000);
      return () => clearTimeout(timer);
    }
  }, [runId, running, pollStatus]);

  const handleRescore = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const res = await fetch("/api/scoring/rescore-all", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setRunId(json.data.runId);
      } else {
        setRunning(false);
      }
    } catch {
      setRunning(false);
    }
  };

  const progress =
    status && status.totalContacts > 0
      ? Math.round(
          ((status.scoredContacts + status.failedContacts) /
            status.totalContacts) *
            100
        )
      : 0;

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRescore}
              disabled={running}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`}
              />
              {running ? "Rescoring..." : "Rescore All"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Re-run all scoring dimensions + referral scoring for every contact.
              Scores update in background.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {running && status && (
        <div className="flex items-center gap-2 min-w-[200px]">
          <Progress value={progress} className="h-1.5 flex-1" />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {status.scoredContacts}/{status.totalContacts}
          </span>
        </div>
      )}

      {!running && status?.status === "completed" && (
        <span className="text-xs text-emerald-600">
          Scored {status.scoredContacts} contacts
          {status.failedContacts > 0 && (
            <span className="text-red-400 ml-1">
              ({status.failedContacts} failed)
            </span>
          )}
        </span>
      )}

      {!running && status?.status === "failed" && (
        <span className="text-xs text-red-400">
          Scoring failed. {status.scoredContacts} scored, {status.failedContacts}{" "}
          failed.
        </span>
      )}
    </div>
  );
}
