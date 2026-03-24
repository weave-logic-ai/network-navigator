"use client";

import { useGoalEngine } from "@/hooks/use-goal-engine";

/**
 * Invisible component that runs the goal engine tick on every page navigation.
 * Mount once in the app layout.
 */
export function GoalEngineRunner() {
  useGoalEngine();
  return null;
}
