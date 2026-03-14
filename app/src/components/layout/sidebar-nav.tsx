"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Home,
  Users,
  Share2,
  Compass,
  Database,
  Send,
  CheckSquare,
  Puzzle,
  Settings,
  Upload,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SidebarNavItem } from "./sidebar-nav-item";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "sidebar-collapsed";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/network", label: "Network", icon: Share2 },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/enrichment", label: "Enrichment", icon: Database },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
];

const secondaryNav = [
  { href: "/extension", label: "Extension", icon: Puzzle },
  { href: "/admin", label: "Admin", icon: Settings },
  { href: "/import", label: "Import", icon: Upload },
];

export function SidebarNav() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) setCollapsed(saved === "true");

    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    function handleKeyboard(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [toggle]);

  const sidebarContent = (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center border-b px-4">
          {!collapsed && (
            <span className="text-lg font-semibold">Prospector</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            className={cn("h-8 w-8", collapsed ? "mx-auto" : "ml-auto")}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>
        <ScrollArea className="flex-1 px-2 py-2">
          <nav className="flex flex-col gap-1">
            {primaryNav.map((item) => (
              <SidebarNavItem key={item.href} {...item} collapsed={collapsed} />
            ))}
          </nav>
          <Separator className="my-3" />
          <nav className="flex flex-col gap-1">
            {secondaryNav.map((item) => (
              <SidebarNavItem key={item.href} {...item} collapsed={collapsed} />
            ))}
          </nav>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <PanelLeft className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[240px] p-0">
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        "hidden border-r bg-background md:flex md:flex-col",
        "transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {sidebarContent}
    </aside>
  );
}
