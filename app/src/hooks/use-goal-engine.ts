"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useGoalToaster } from "@/components/goals/goal-toaster";

const DEBOUNCE_MS = 3000; // Max 1 tick per 3 seconds
const PAGE_MAP: Record<string, string> = {
  "/discover": "discover",
  "/contacts": "contacts",
  "/dashboard": "dashboard",
  "/tasks": "tasks",
  "/network": "network",
  "/outreach": "outreach",
  "/import": "import",
  "/admin": "admin",
  "/extension": "extension",
};

function pathToPage(pathname: string): string {
  // Match longest prefix
  for (const [prefix, page] of Object.entries(PAGE_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return page;
    }
  }
  return "dashboard";
}

interface TickOptions {
  selectedNicheId?: string;
  selectedIcpId?: string;
  selectedOfferingIds?: string[];
  viewingContactId?: string;
}

export function useGoalEngine(options: TickOptions = {}) {
  const pathname = usePathname();
  const { showGoal, showWarning } = useGoalToaster();
  const lastTickRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fireTick = useCallback(async () => {
    const now = Date.now();
    if (now - lastTickRef.current < DEBOUNCE_MS) return;
    lastTickRef.current = now;

    // Abort any in-flight tick
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/goals/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: pathToPage(pathname),
          ...options,
        }),
        signal: controller.signal,
      });

      if (!res.ok) return;
      const json = await res.json();
      const data = json.data;

      // Show goal toasts
      for (const goal of data?.newGoals ?? []) {
        // We need the goal ID from the DB — query for the latest suggested goal matching this title
        const goalsRes = await fetch(`/api/goals?status=suggested&limit=5`);
        if (goalsRes.ok) {
          const goalsJson = await goalsRes.json();
          const match = (goalsJson.data ?? []).find(
            (g: { title: string }) => g.title === goal.title
          );
          if (match) {
            showGoal({
              goalId: match.id,
              title: goal.title,
              description: goal.description,
              priority: goal.priority,
            });
          }
        }
      }

      // Show error warnings
      for (const error of data?.errors ?? []) {
        showWarning(error);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Silent — don't block the UI
    }
  }, [pathname, options, showGoal, showWarning]);

  // Fire on pathname change
  useEffect(() => {
    fireTick();
  }, [fireTick]);

  return { fireTick };
}
