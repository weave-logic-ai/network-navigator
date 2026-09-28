"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { PipelineSnapshotLoader } from "@/lib/outreach/pipeline-snapshot";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  campaign_id: string | null;
  campaign_name: string | null;
  event_version: number;
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
  total_meetings: number;
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
  const [activeTab, setActiveTab] = useState("pipeline");
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);

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
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", description: "" });
  const [audienceCampaign, setAudienceCampaign] = useState<Campaign | null>(null);
  const [audienceTier, setAudienceTier] = useState("all");
  const [audiencePreview, setAudiencePreview] = useState<Array<{ id: string; full_name: string | null; tier: string }> | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  const [perfStats, setPerfStats] = useState<PerfStat[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const pipeline = useMemo(() => new PipelineSnapshotLoader<PipelineContact>(
    () => { setStages({}); setPipelineLoading(true); setPipelineError(null); },
    ({ stages }) => { setStages(stages); setPipelineLoading(false); setPipelineError(null); },
    () => { setPipelineLoading(false); setPipelineError("Could not load the pipeline. Try again."); },
  ), []);

  const selectCampaign = (campaignId: string) => {
    pipeline.select(campaignId);
    setFilterCampaign(campaignId);
  };

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
    pipeline.select("");
    Promise.all([fetchTemplates(), fetchCampaigns()]).then(
      () => setLoading(false)
    );
    return () => pipeline.dispose();
  }, [pipeline, fetchTemplates, fetchCampaigns]);

  const fetchPerformance = useCallback(async () => {
    const res = await fetch("/api/outreach/performance");
    if (res.ok) setPerfStats((await res.json()).data ?? []);
  }, []);
  useEffect(() => { fetchPerformance(); }, [fetchPerformance]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleMoveContact = async (
    _contactId: string,
    outreachStateId: string,
    cardCampaignId: string | null,
    newStage: string,
    eventVersion: number
  ) => {
    const campaignAtMove = filterCampaign;
    try {
      const res = await fetch(`/api/outreach/pipeline/${outreachStateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage, campaign_id: campaignAtMove || cardCampaignId, event_version: eventVersion }),
      });
      if (!res.ok) throw new Error("Could not move contact.");
      pipeline.refresh(campaignAtMove);
    } catch {
      if (pipeline.isSelected(campaignAtMove)) {
        setPipelineError("Pipeline changed. Review the latest stage and try again.");
        pipeline.refresh(campaignAtMove);
      }
    }
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
    const res = await fetch(editingCampaign ? `/api/outreach/campaigns/${editingCampaign.id}` : "/api/outreach/campaigns", {
      method: editingCampaign ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignForm),
    });
    if (!res.ok) { setCampaignError("Could not save campaign."); return; }
    setCampaignDialogOpen(false);
    setEditingCampaign(null);
    setCampaignForm({ name: "", description: "" });
    fetchCampaigns();
  };

  const previewAudience = async (campaign: Campaign, tier = audienceTier) => {
    setCampaignError(null);
    const suffix = tier === "all" ? "" : `&tier=${tier}`;
    const res = await fetch(`/api/outreach/campaigns/${campaign.id}/populate?limit=100${suffix}`);
    if (!res.ok) { setCampaignError("Could not preview audience."); return; }
    setAudiencePreview((await res.json()).data ?? []);
  };

  const enrollAudience = async () => {
    if (!audienceCampaign || !audiencePreview?.length) return;
    const suffix = audienceTier === "all" ? "" : `&tier=${audienceTier}`;
    const res = await fetch(`/api/outreach/campaigns/${audienceCampaign.id}/populate?limit=100${suffix}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: audiencePreview.map(contact => contact.id) }),
    });
    if (!res.ok) {
      setCampaignError("Audience changed or could not be enrolled. Preview again before trying.");
      setAudiencePreview(null);
      return;
    }
    await Promise.all([fetchCampaigns(), previewAudience(audienceCampaign), Promise.resolve(pipeline.refresh(filterCampaign))]);
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Pipeline */}
        <TabsContent value="pipeline">
          {pipelineError && <p role="alert" className="mb-4 text-sm text-destructive">{pipelineError}</p>}
          {!pipelineLoading && PIPELINE_STAGES.every((stage) => (stages[stage] ?? []).length === 0) && !pipelineError && (
            <Card className="mb-4">
              <CardContent className="flex flex-col items-start gap-3 p-6">
                <p className="text-sm text-muted-foreground">
                  {filterCampaign ? "No contacts are in this campaign yet." : "Your outreach pipeline is empty. Create a campaign to organize future outreach."}
                </p>
                {filterCampaign ? (
                  <Button size="sm" variant="outline" onClick={() => selectCampaign("")}>
                    View all campaigns
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => { setActiveTab("campaigns"); setEditingCampaign(null); setCampaignForm({ name: "", description: "" }); setCampaignDialogOpen(true); }}>
                    Create campaign
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
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
              onValueChange={(v) => selectCampaign(v === "all" ? "" : v)}
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
          {pipelineLoading && <p role="status" className="mb-3 text-sm text-muted-foreground">Loading pipeline...</p>}
          <div className="flex gap-3 overflow-x-auto pb-4">
            {PIPELINE_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                contacts={pipelineLoading ? [] : filterContacts(stages[stage] ?? [])}
                showCampaign={!filterCampaign}
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
            <Button size="sm" onClick={() => { setEditingCampaign(null); setCampaignForm({ name: "", description: "" }); setCampaignDialogOpen(true); }}>
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
                  <TableHead className="text-right">Contacts sent</TableHead>
                  <TableHead className="text-right">Contacts replied</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <CampaignRow key={c.id} campaign={c} onEdit={(campaign) => {
                    setEditingCampaign(campaign);
                    setCampaignForm({ name: campaign.name, description: campaign.description ?? "" });
                    setCampaignDialogOpen(true);
                  }} onAudience={(campaign) => {
                    setAudienceCampaign(campaign); setAudienceTier("all"); setAudiencePreview(null);
                    previewAudience(campaign, "all");
                  }} />
                ))}
                {campaigns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
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
                <DialogTitle>{editingCampaign ? "Edit Campaign" : "New Campaign"}</DialogTitle>
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
                <Button onClick={saveCampaign}>{editingCampaign ? "Save" : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={!!audienceCampaign} onOpenChange={(open) => { if (!open) setAudienceCampaign(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Audience for {audienceCampaign?.name}</DialogTitle>
                <DialogDescription>Preview eligible contacts before adding them to this campaign. This does not send messages.</DialogDescription>
              </DialogHeader>
              <Select value={audienceTier} onValueChange={(tier) => {
                setAudienceTier(tier); setAudiencePreview(null);
                if (audienceCampaign) previewAudience(audienceCampaign, tier);
              }}>
                <SelectTrigger aria-label="Audience tier"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All scored tiers</SelectItem>
                  {['gold', 'silver', 'bronze', 'watch'].map(tier => <SelectItem key={tier} value={tier}>{tier}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-sm">{audiencePreview ? `${audiencePreview.length} eligible contacts (first 100)` : "Loading preview..."}</p>
              <div className="max-h-48 overflow-y-auto text-sm">
                {audiencePreview?.map(contact => <p key={contact.id}>{contact.full_name ?? "Unnamed contact"} · {contact.tier}</p>)}
              </div>
              <DialogFooter><Button disabled={!audiencePreview?.length || audienceCampaign?.status !== 'draft'} onClick={enrollAudience}>Enroll previewed audience</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          {campaignError && <p role="alert" className="text-sm text-destructive">{campaignError}</p>}
        </TabsContent>

        {/* Sequences */}
        <TabsContent value="sequences">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outreach Sequences</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Sequence scheduling and sending are unavailable. Use draft campaigns to organize contacts and the pipeline to track outcomes.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance */}
        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recorded events by attached template</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">Each column counts contacts independently by the template ID on that event. An untagged reply appears under Unattributed events; these counts are not a conversion funnel.</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Contacts sent</TableHead>
                    <TableHead className="text-right">Contacts opened</TableHead>
                    <TableHead className="text-right">Contacts replied</TableHead>
                    <TableHead className="text-right">Contacts booked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perfStats.map((s) => (
                      <TableRow key={s.template_id}>
                        <TableCell className="font-medium">{s.template_name}</TableCell>
                        <TableCell className="text-right">{s.total_sent}</TableCell>
                        <TableCell className="text-right">{s.total_opened}</TableCell>
                        <TableCell className="text-right">{s.total_replied}</TableCell>
                        <TableCell className="text-right">{s.total_meetings}</TableCell>
                      </TableRow>
                  ))}
                  {perfStats.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No recorded delivery events yet.
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
