"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  showBack?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  showBack,
}: PageHeaderProps) {
  const router = useRouter();

  return (
    <div className="mb-6 min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {showBack && (
            <Button variant="ghost" size="icon" aria-label="Go back" className="shrink-0" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="break-words text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <Separator className="mt-4" />
    </div>
  );
}
