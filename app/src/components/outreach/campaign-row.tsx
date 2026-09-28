"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Pencil } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  target_count: number;
  sent_count: number;
  response_count: number;
  created_at: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  draft: "secondary",
  paused: "outline",
  completed: "outline",
  archived: "destructive",
};

interface CampaignRowProps {
  campaign: Campaign;
  onEdit: (campaign: Campaign) => void;
  onAudience: (campaign: Campaign) => void;
  onStatusChange: (campaign: Campaign, status: string) => void;
}

// Keep in sync with CAMPAIGN_STATUSES (server validates).
const STATUSES = ["draft", "active", "paused", "completed", "archived"];

export function CampaignRow({ campaign, onEdit, onAudience, onStatusChange }: CampaignRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{campaign.name}</TableCell>
      <TableCell>
        <Select value={campaign.status} onValueChange={(status) => onStatusChange(campaign, status)}>
          <SelectTrigger className="h-7 w-[120px] border-none px-0 shadow-none" aria-label={`Status of ${campaign.name}`}>
            <SelectValue>
              <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>{campaign.status}</Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{status}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">{campaign.target_count}</TableCell>
      <TableCell className="text-right">{campaign.sent_count}</TableCell>
      <TableCell className="text-right">{campaign.response_count}</TableCell>
      <TableCell>
        <Button variant="outline" size="sm" onClick={() => onAudience(campaign)}>Audience</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(campaign)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
