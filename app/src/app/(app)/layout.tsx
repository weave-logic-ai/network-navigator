import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { GoalToasterProvider } from "@/components/goals/goal-toaster";
import { GoalEngineRunner } from "@/components/goals/goal-engine-runner";
import { SuggestionEngineProvider } from "@/components/suggestion-engine-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SuggestionEngineProvider>
      <GoalToasterProvider>
        <AppShell>
          {children}
          <CommandPalette />
        </AppShell>
        <GoalEngineRunner />
      </GoalToasterProvider>
    </SuggestionEngineProvider>
  );
}
