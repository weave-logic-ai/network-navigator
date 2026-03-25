"use client";

import { useGoalEngine } from "@/hooks/use-goal-engine";
import { useSuggestionEngine } from "@/hooks/use-suggestion-engine";

/**
 * Invisible component that runs the goal engine tick on every page navigation.
 * Mount once in the app layout. Respects the suggestion engine toggle.
 */
export function GoalEngineRunner() {
  const { enabled } = useSuggestionEngine();
  useGoalEngine({ disabled: !enabled });
  return null;
}
