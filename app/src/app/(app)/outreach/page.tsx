"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KanbanColumn } from "@/components/outreach/kanban-column";
import { TemplateCard } from "@/components/outreach/template-card";
import { CampaignRow } from "@/components/outreach/campaign-row";
import { Plus, Search } from "lucide-react";
import { OutreachFunnel } from "@/components/charts/outreach-funnel";
import { OutreachSequenceTree } from "@/components/charts/outreach-sequence-tree";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface PerfStat {
  template_id: string;
  template_name: string;
  total_sent: number;
  total_opened: number;
  total_replied: number;
  total_accepted: number;
}

const PIPELINE_STAGES = [
  "not_started",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
] as const;

const CATEGORIES = [
  { value: "initial_outreach", label: "Initial Outreach" },
  { value: "follow_up", label: "Follow-up" },
  { value: "meeting_request", label: "Meeting Request" },
  { value: "referral_ask", label: "Referral Ask" },
  { value: "content_share", label: "Content Share" },
  { value: "custom", label: "Custom" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OutreachPage() {
  const [stages, setStages] = useState<Record<string, PipelineContact[]>>({});
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filterCampaign, setFilterCampaign] = useState("");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    category: "custom",
    subject_template: "",
    body_template: "",
  });

  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ name: "", description: "" });

  const [perfStats, setPerfStats] = useState<PerfStat[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchPipeline = useCallback(async () => {
    try {
      const qs = filterCampaign ? `?campaign_id=${filterCampaign}` : "";
      const res = await fetch(`/api/outreach/pipeline${qs}`);
      const json = await res.json();
      setStages(json.stages ?? {});
    } catch {
      /* ignore */
    }
  }, [filterCampaign]);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/templates");
      const json = await res.json();
      setTemplates(json.data ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/campaigns");
      const json = await res.json();
      setCampaigns(json.data ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchPipeline(), fetchTemplates(), fetchCampaigns()]).then(
      () => setLoading(false)
    );
  }, [fetchPipeline, fetchTemplates, fetchCampaigns]);

  useEffect(() => {
    setPerfStats(
      templates.map((t) => ({
        template_id: t.id,
        template_name: t.name,
        total_sent: 0,
        total_opened: 0,
        total_replied: 0,
        total_accepted: 0,
      }))
    );
  }, [templates]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleMoveContact = async (
    contactId: string,
    _outreachStateId: string,
    newStage: string
  ) => {
    const stageToEvent: Record<string, string> = {
      contacted: "sent",
      replied: "replied",
      meeting_booked: "meeting_booked",
      won: "accepted",
      lost: "declined",
    };
    const eventType = stageToEvent[newStage];
    if (!eventType) return;

    await fetch("/api/outreach/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_id: contactId,
        event_type: eventType,
        campaign_id: filterCampaign || undefined,
      }),
    });
    fetchPipeline();
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: "", category: "custom", subject_template: "", body_template: "" });
    setTemplateDialogOpen(true);
  };

  const openEditTemplate = (t: Template) => {
    setEditingTemplate(t as Template);
    setTemplateForm({
      name: t.name,
      category: t.category,
      subject_template: t.subject_template ?? "",
      body_template: t.body_template,
    });
    setTemplateDialogOpen(true);
  };

  const saveTemplate = async () => {
    if (!templateForm.name || !templateForm.body_template) return;
    if (editingTemplate) {
      await fetch(`/api/outreach/templates/${editingTemplate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });
    } else {
      await fetch("/api/outreach/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });
    }
    setTemplateDialogOpen(false);
    fetchTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    await fetch(`/api/outreach/templates/${id}`, { method: "DELETE" });
    fetchTemplates();
  };

  const saveCampaign = async () => {
    if (!campaignForm.name) return;
    await fetch("/api/outreach/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignForm),
    });
    setCampaignDialogOpen(false);
    setCampaignForm({ name: "", description: "" });
    fetchCampaigns();
  };

  const filterContacts = (contacts: PipelineContact[]) => {
    if (!pipelineSearch) return contacts;
    const q = pipelineSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(q) ||
        (c.title ?? "").toLowerCase().includes(q) ||
        (c.current_company ?? "").toLowerCase().includes(q)
    );
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Outreach" description="Pipeline, templates, and campaigns" />
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Loading outreach data...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Outreach" description="Pipeline, templates, and campaigns" />

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Pipeline */}
        <TabsContent value="pipeline">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <OutreachFunnel
                data={PIPELINE_STAGES.map((stage) => ({
                  stage: stage.replace(/_/g, " "),
                  count: (stages[stage] ?? []).length,
                }))}
              />
            </CardContent>
          </Card>
          <div className="mb-4 flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                value={pipelineSearch}
                onChange={(e) => setPipelineSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select
              value={filterCampaign || "all"}
              onValueChange={(v) => setFilterCampaign(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {PIPELINE_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                contacts={filterContacts(stages[stage] ?? [])}
                onMoveContact={handleMoveContact}
              />
            ))}
          </div>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates">
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={openNewTemplate}>
              <Plus className="mr-1 h-4 w-4" />
              New Template
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={openEditTemplate}
                onDelete={handleDeleteTemplate}
              />
            ))}
            {templates.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="p-6 text-center text-muted-foreground">
                  No templates yet. Create one to get started.
                </CardContent>
              </Card>
            )}
          </div>
          <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle>
                <DialogDescription>
                  {editingTemplate
                    ? "Update the template details below."
                    : "Create a new outreach template. Use merge variables like {{first_name}}, {{company}}, {{title}}."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Input
                  placeholder="Template name"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                />
                <Select
                  value={templateForm.category}
                  onValueChange={(v) => setTemplateForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Subject (optional)"
                  value={templateForm.subject_template}
                  onChange={(e) => setTemplateForm((f) => ({ ...f, subject_template: e.target.value }))}
                />
                <Textarea
                  placeholder="Message body. Use {{first_name}}, {{company}}, {{title}}, {{mutual_connections}}"
                  rows={6}
                  value={templateForm.body_template}
                  onChange={(e) => setTemplateForm((f) => ({ ...f, body_template: e.target.value }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
                <Button onClick={saveTemplate}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Campaigns */}
        <TabsContent value="campaigns">
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={() => setCampaignDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New Campaign
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Responses</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <CampaignRow key={c.id} campaign={c} onEdit={() => {}} />
                ))}
                {campaigns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No campaigns yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
          <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Campaign</DialogTitle>
                <DialogDescription>
                  Create a new outreach campaign to organize your contact outreach.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Input
                  placeholder="Campaign name"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm((f) => ({ ...f, name: e.target.value }))}
                />
                <Textarea
                  placeholder="Description (optional)"
                  rows={3}
                  value={campaignForm.description}
                  onChange={(e) => setCampaignForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCampaignDialogOpen(false)}>Cancel</Button>
                <Button onClick={saveCampaign}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Sequences */}
        <TabsContent value="sequences">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outreach Sequences</CardTitle>
            </CardHeader>
            <CardContent>
              <OutreachSequenceTree
                data={{
                  name: "Initial",
                  children: [
                    {
                      name: "Replied",
                      count: (stages["replied"] ?? []).length,
                      children: [
                        { name: "Meeting", count: (stages["meeting_booked"] ?? []).length },
                      ],
                    },
                    {
                      name: "No Reply",
                      count: 0,
                      children: [
                        {
                          name: "Follow-up",
                          count: 0,
                          children: [
                            { name: "Replied", count: 0 },
                            { name: "Close", count: (stages["lost"] ?? []).length },
                          ],
                        },
                      ],
                    },
                  ],
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance */}
        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Template Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Open %</TableHead>
                    <TableHead className="text-right">Replied</TableHead>
                    <TableHead className="text-right">Reply %</TableHead>
                    <TableHead className="text-right">Meetings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perfStats.map((s) => {
                    const openRate = s.total_sent > 0
                      ? ((s.total_opened / s.total_sent) * 100).toFixed(1) : "0.0";
                    const replyRate = s.total_sent > 0
                      ? ((s.total_replied / s.total_sent) * 100).toFixed(1) : "0.0";
                    return (
                      <TableRow key={s.template_id}>
                        <TableCell className="font-medium">{s.template_name}</TableCell>
                        <TableCell className="text-right">{s.total_sent}</TableCell>
                        <TableCell className="text-right">{s.total_opened}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{openRate}%</Badge>
                        </TableCell>
                        <TableCell className="text-right">{s.total_replied}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{replyRate}%</Badge>
                        </TableCell>
                        <TableCell className="text-right">{s.total_accepted}</TableCell>
                      </TableRow>
                    );
                  })}
                  {perfStats.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No performance data. Create templates and start campaigns.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
