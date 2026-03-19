"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PipelineContact {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_company: string | null;
  tier: string | null;
  state: string;
  last_action_at: string | null;
  outreach_state_id: string;
}

const STAGES = [
  "not_started",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
] as const;

const STAGE_LABELS: Record<string, string> = {
  not_started: "Not Started",
  contacted: "Contacted",
  replied: "Replied",
  meeting_booked: "Meeting Booked",
  won: "Won",
  lost: "Lost",
};

const TIER_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  A: "default",
  B: "secondary",
  C: "outline",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString();
}

function displayName(contact: PipelineContact): string {
  return (
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "Unknown"
  );
}

interface KanbanColumnProps {
  stage: string;
  contacts: PipelineContact[];
  onMoveContact: (contactId: string, outreachStateId: string, newStage: string) => void;
}

export function KanbanColumn({ stage, contacts, onMoveContact }: KanbanColumnProps) {
  const otherStages = STAGES.filter((s) => s !== stage);

  return (
    <div className="flex min-w-[250px] flex-col gap-2">
      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
        <span className="text-sm font-semibold">{STAGE_LABELS[stage] ?? stage}</span>
        <Badge variant="outline" className="text-xs">
          {contacts.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-2">
        {contacts.map((contact) => (
          <Card key={contact.id} className="shadow-sm">
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-sm font-medium leading-tight">
                {displayName(contact)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0">
              {contact.title && (
                <p className="text-xs text-muted-foreground truncate">
                  {contact.title}
                </p>
              )}
              {contact.current_company && (
                <p className="text-xs text-muted-foreground truncate">
                  {contact.current_company}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {contact.tier && (
                    <Badge variant={TIER_VARIANT[contact.tier] ?? "outline"} className="text-[10px] px-1.5 py-0">
                      {contact.tier}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(contact.last_action_at)}
                  </span>
                </div>
                <Select
                  onValueChange={(val) =>
                    onMoveContact(contact.id, contact.outreach_state_id, val)
                  }
                >
                  <SelectTrigger className="h-6 w-[90px] text-[10px]">
                    <SelectValue placeholder="Move" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherStages.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {STAGE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        ))}
        {contacts.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No contacts
          </p>
        )}
      </div>
    </div>
  );
}
