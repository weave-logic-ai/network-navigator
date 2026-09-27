import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { AppHeader } from "./app-header";
import { RESEARCH_FLAGS } from "@/lib/config/research-flags";
import { getCurrentOwnerProfileId } from "@/lib/targets/service";

export async function AppShell({ children }: { children: ReactNode }) {
  const targetsAvailable = RESEARCH_FLAGS.targets && Boolean(await getCurrentOwnerProfileId());
  return (
    <div className="flex h-dvh min-h-0 min-w-0 overflow-hidden">
      <SidebarNav researchFlags={RESEARCH_FLAGS} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-w-0 shrink-0 overflow-x-auto">
          <AppHeader targetsEnabled={targetsAvailable} />
        </div>
        <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
