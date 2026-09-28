"use client";

import { usePathname } from "next/navigation";
import { Search, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";

function getBreadcrumbs(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

export function AppHeader({ targetsEnabled }: { targetsEnabled: boolean }) {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);

  return (
    <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-4 border-b bg-background px-3 py-2 sm:px-6">
      <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <span
              className={
                i === breadcrumbs.length - 1
                  ? "font-medium text-foreground"
                  : ""
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {targetsEnabled && (
          <Button type="button" variant="outline" size="sm" onClick={() => {
            window.dispatchEvent(new Event("open-target-picker"));
          }}>
            <Crosshair className="mr-2 h-4 w-4" aria-hidden="true" />Choose target
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" aria-label="Search contacts and pages" onClick={() => {
          window.dispatchEvent(new Event("open-command-palette"));
        }}>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />Search
        </Button>
      </div>
    </header>
  );
}
