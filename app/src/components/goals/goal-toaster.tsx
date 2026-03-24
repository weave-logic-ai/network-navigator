"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Target, X, Check, AlertTriangle } from "lucide-react";

interface GoalToast {
  id: string;
  goalId: string;
  title: string;
  description: string;
  priority: number;
  type: "goal" | "warning";
}

interface GoalToasterContextValue {
  showGoal: (toast: Omit<GoalToast, "id" | "type">) => void;
  showWarning: (message: string) => void;
}

const GoalToasterContext = createContext<GoalToasterContextValue>({
  showGoal: () => {},
  showWarning: () => {},
});

export function useGoalToaster() {
  return useContext(GoalToasterContext);
}

export function GoalToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<GoalToast[]>([]);

  const showGoal = useCallback((toast: Omit<GoalToast, "id" | "type">) => {
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id, type: "goal" }]);
  }, []);

  const showWarning = useCallback((message: string) => {
    const id = `warn-${Date.now()}`;
    setToasts((prev) => {
      // Dedup warnings with same message
      if (prev.some((t) => t.type === "warning" && t.title === message)) return prev;
      return [...prev, { id, goalId: "", title: message, description: "", priority: 5, type: "warning" }];
    });
    // Auto-dismiss warnings after 8 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleAccept = useCallback(async (toast: GoalToast) => {
    try {
      await fetch(`/api/goals/${toast.goalId}/accept`, { method: "POST" });
    } catch {
      // silent
    }
    dismiss(toast.id);
  }, [dismiss]);

  const handleReject = useCallback(async (toast: GoalToast) => {
    try {
      await fetch(`/api/goals/${toast.goalId}/reject`, { method: "POST" });
    } catch {
      // silent
    }
    dismiss(toast.id);
  }, [dismiss]);

  return (
    <GoalToasterContext.Provider value={{ showGoal, showWarning }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg border shadow-lg p-4 animate-in slide-in-from-right-5 fade-in duration-300 ${
              toast.type === "warning"
                ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
                : "bg-background border-border"
            }`}
          >
            <div className="flex items-start gap-3">
              {toast.type === "warning" ? (
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              ) : (
                <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">{toast.title}</p>
                {toast.description && (
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">
                    {toast.description}
                  </p>
                )}
                {toast.type === "goal" && (
                  <div className="flex gap-2 mt-2.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleAccept(toast)}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => handleReject(toast)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
              <button
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => toast.type === "goal" ? handleReject(toast) : dismiss(toast.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </GoalToasterContext.Provider>
  );
}
