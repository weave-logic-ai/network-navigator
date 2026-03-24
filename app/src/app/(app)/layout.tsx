import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { GoalToasterProvider } from "@/components/goals/goal-toaster";
import { GoalEngineRunner } from "@/components/goals/goal-engine-runner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <GoalToasterProvider>
      <AppShell>
        {children}
        <CommandPalette />
      </AppShell>
      <GoalEngineRunner />
    </GoalToasterProvider>
  );
}
