"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
}

export function CampaignRow({ campaign, onEdit }: CampaignRowProps) {
  const responseRate =
    campaign.sent_count > 0
      ? ((campaign.response_count / campaign.sent_count) * 100).toFixed(1)
      : "0.0";

  return (
    <TableRow>
      <TableCell className="font-medium">{campaign.name}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
          {campaign.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{campaign.target_count}</TableCell>
      <TableCell className="text-right">{campaign.sent_count}</TableCell>
      <TableCell className="text-right">{campaign.response_count}</TableCell>
      <TableCell className="text-right">{responseRate}%</TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(campaign)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
