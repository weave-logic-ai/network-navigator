import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { AppHeader } from "./app-header";
import { RESEARCH_FLAGS } from "@/lib/config/research-flags";
import { getCurrentOwnerProfileId } from "@/lib/targets/service";

export async function AppShell({ children }: { children: ReactNode }) {
  const targetsAvailable = RESEARCH_FLAGS.targets && Boolean(await getCurrentOwnerProfileId());
  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav researchFlags={RESEARCH_FLAGS} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppHeader targetsEnabled={targetsAvailable} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
