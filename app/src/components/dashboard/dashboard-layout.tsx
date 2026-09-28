import type { ReactNode } from "react";
import { RESEARCH_FLAGS } from "@/lib/config/research-flags";
import {
  getCurrentOwnerProfileId,
  getOrCreateSelfTarget,
  getResearchTargetState,
  getTargetById,
} from "@/lib/targets/service";
import type { ResearchTarget } from "@/lib/targets/types";

interface DashboardLayoutProps {
  comparisonSlot: (self: ResearchTarget, focused: ResearchTarget) => ReactNode;
  ownerWideSlot: ReactNode;
}

export async function DashboardLayout({ comparisonSlot, ownerWideSlot }: DashboardLayoutProps) {
  if (!RESEARCH_FLAGS.targets) return <DashboardShell>{ownerWideSlot}</DashboardShell>;

  const ownerId = await getCurrentOwnerProfileId();
  if (!ownerId) return <DashboardShell>{ownerWideSlot}</DashboardShell>;

  const state = await getResearchTargetState(ownerId);
  // Resolve self from the owner, never from a mutable state pointer.
  const self = await getOrCreateSelfTarget(ownerId);
  const focused = state?.secondaryTargetId
    ? await getTargetById(state.secondaryTargetId)
    : null;
  const comparable = self && focused && focused.tenantId === self.tenantId &&
    focused.kind === "contact" && focused.id !== self.id;

  return (
    <DashboardShell>
      {comparable && comparisonSlot(self, focused)}
      {focused?.kind === "company" && focused.tenantId === self?.tenantId && (
        <p className="text-sm text-muted-foreground" data-testid="dashboard-company-unavailable">
          Contact metrics are unavailable for company targets.
        </p>
      )}
      {ownerWideSlot}
    </DashboardShell>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}
