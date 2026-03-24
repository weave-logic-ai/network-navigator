"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Loader2,
  Pencil,
  BookOpen,
  Star,
  Users,
  MessageSquare,
} from "lucide-react";

export interface Suggestion {
  type:
    | "profile_update"
    | "content"
    | "network_growth"
    | "skill_add"
    | "engagement";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  effort: "quick" | "moderate" | "significant";
  taskTemplate: {
    title: string;
    description: string;
    taskType: string;
    url?: string;
  };
}

interface GapSuggestionsProps {
  suggestions: Suggestion[];
  onTaskCreated?: () => void;
}

const impactColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-green-100 text-green-800 border-green-200",
};

const effortLabels: Record<string, string> = {
  quick: "Quick win",
  moderate: "Moderate effort",
  significant: "Significant effort",
};

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  profile_update: Pencil,
  content: BookOpen,
  skill_add: Star,
  network_growth: Users,
  engagement: MessageSquare,
};

const typeLabels: Record<string, string> = {
  profile_update: "Profile Update",
  content: "Content Strategy",
  skill_add: "Skill Addition",
  network_growth: "Network Growth",
  engagement: "Engagement",
};

function SuggestionCard({
  suggestion,
  onTaskCreated,
}: {
  suggestion: Suggestion;
  onTaskCreated?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const Icon = typeIcons[suggestion.type] || AlertTriangle;

  async function handleCreateTask() {
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestion.taskTemplate.title,
          description: suggestion.taskTemplate.description,
          taskType: suggestion.taskTemplate.taskType,
          url: suggestion.taskTemplate.url,
          metadata: {
            source: "gap_analysis",
            suggestionType: suggestion.type,
            impact: suggestion.impact,
          },
        }),
      });
      if (res.ok) {
        setCreated(true);
        onTaskCreated?.();
      }
    } catch {
      // Silent fail
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-sm truncate">
            {suggestion.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${impactColors[suggestion.impact]}`}
          >
            {suggestion.impact}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {effortLabels[suggestion.effort]}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{suggestion.description}</p>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {typeLabels[suggestion.type]}
        </span>
        {created ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle className="h-3.5 w-3.5" />
            Task created
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleCreateTask}
            disabled={creating}
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                Create Task <ArrowRight className="h-3 w-3" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function GapSuggestions({
  suggestions,
  onTaskCreated,
}: GapSuggestionsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Optimization Suggestions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s, i) => (
          <SuggestionCard
            key={i}
            suggestion={s}
            onTaskCreated={onTaskCreated}
          />
        ))}
      </CardContent>
    </Card>
  );
}
