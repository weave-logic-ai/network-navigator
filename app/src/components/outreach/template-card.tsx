"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

interface Template {
  id: string;
  name: string;
  category: string;
  subject_template: string | null;
  body_template: string;
  merge_variables?: string[];
  tone?: string;
  is_active: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  initial_outreach: "Initial",
  follow_up: "Follow-up",
  meeting_request: "Meeting",
  referral_ask: "Referral",
  content_share: "Content",
  custom: "Custom",
};

interface TemplateCardProps {
  template: Template;
  onEdit: (template: Template) => void;
  onDelete: (id: string) => void;
}

export function TemplateCard({ template, onEdit, onDelete }: TemplateCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm font-medium">{template.name}</CardTitle>
          <div className="flex gap-1">
            <Badge variant="secondary" className="text-[10px]">
              {CATEGORY_LABELS[template.category] ?? template.category}
            </Badge>
            {!template.is_active && (
              <Badge variant="outline" className="text-[10px]">Inactive</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {template.subject_template && (
          <p className="text-xs font-medium text-muted-foreground mb-1 truncate">
            Subject: {template.subject_template}
          </p>
        )}
        <p className="text-xs text-muted-foreground line-clamp-3">
          {template.body_template}
        </p>
        <div className="mt-3 flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(template)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(template.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
