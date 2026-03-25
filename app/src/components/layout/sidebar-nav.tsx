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
  UserCircle,
  PanelLeftClose,
  PanelLeft,
  Info,
} from "lucide-react";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SidebarNavItem } from "./sidebar-nav-item";
import { useSuggestionEngine } from "@/hooks/use-suggestion-engine";
import { cn } from "@/lib/utils";

const SIDEBAR_KEY = "sidebar-collapsed";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/network", label: "Network", icon: Share2 },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/enrichment", label: "Enrichment", icon: Database },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/tasks", label: "Goals & Tasks", icon: CheckSquare },
];

const secondaryNav = [
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/extension", label: "Extension", icon: Puzzle },
  { href: "/admin", label: "Admin", icon: Settings },
  { href: "/import", label: "Import", icon: Upload },
];

export function SidebarNav() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { enabled: suggestionsEnabled, toggle: toggleSuggestions } = useSuggestionEngine();

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
        <div className="border-t px-3 py-3">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">
                  <Switch
                    checked={suggestionsEnabled}
                    onCheckedChange={toggleSuggestions}
                    className="scale-125"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">Suggestion Engine</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">
                  Auto-generates goal and outreach suggestions based on your network data. Keep off until you have imported your contacts and configured an ICP.
                </p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                checked={suggestionsEnabled}
                onCheckedChange={toggleSuggestions}
                className="scale-125"
              />
              <span className="text-xs font-medium text-muted-foreground select-none">
                Suggestions
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[240px]">
                  <p className="text-xs">
                    When enabled, the suggestion engine automatically generates goals and outreach recommendations as you navigate. Keep this off until you have imported your contacts and set up at least one ICP profile.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
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
