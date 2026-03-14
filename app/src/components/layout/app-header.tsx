"use client";

import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

function getBreadcrumbs(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

export function AppHeader() {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
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
      <div className="ml-auto flex items-center gap-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-8" disabled />
        </div>
      </div>
    </header>
  );
}
