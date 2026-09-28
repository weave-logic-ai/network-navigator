"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TierBadge } from "@/components/scoring/tier-badge";
import { ContactTooltip } from "@/components/contacts/contact-tooltip";
import { Sparkles, ExternalLink, Search, ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";

interface Contact {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  currentCompany: string | null;
  compositeScore: number | null;
  tier: string | null;
}

interface Pagination { page: number; limit: number; total: number; totalPages: number }

interface BulkPreview {
  contactId: string;
  totalCostCents: number;
  partial?: boolean;
  delta: Array<{ field: string; label: string; oldValue: string | null; newValue: string | null; selected: boolean }>;
}

export function remainingBulkContactIds(ids: string[], reviewed: BulkPreview[]): string[] {
  const completed = new Set(reviewed.filter(item => !item.partial).map(item => item.contactId));
  return ids.filter(id => !completed.has(id));
}

interface PeoplePanelProps {
  selectedNiche: string | null;
  selectedIcp: string | null;
  selectedOfferings: string[];
}

type SortField = "score" | "name" | "company";

const CheckSvg = () => (
  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M2 6l3 3 5-5" />
  </svg>
);

function Checkbox({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`h-4 w-4 rounded border flex items-center justify-center ${
        checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
      }`}
      onClick={onClick}
      aria-label={label}
    >
      {checked && <CheckSvg />}
    </button>
  );
}

function nameOf(c: Contact): string {
  return c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

export function PeoplePanel({ selectedNiche, selectedIcp, selectedOfferings }: PeoplePanelProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pag, setPag] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortField>("score");
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [bulkScoring, setBulkScoring] = useState(false);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<BulkPreview[]>([]);
  const [previewStop, setPreviewStop] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<{ ids: string[]; quote: string } | null>(null);
  const [resumeIds, setResumeIds] = useState<string[]>([]);
  const [resumeBlocked, setResumeBlocked] = useState(false);
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [expanding, setExpanding] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('discover-enrichment-pending-quote');
      if (saved) {
        const parsed = JSON.parse(saved) as { ids: string[]; quote: string };
        if (Array.isArray(parsed.ids) && typeof parsed.quote === 'string') {
          setPendingQuote(parsed);
          setSelected(new Set(parsed.ids));
        }
      }
    } catch { /* invalid local recovery state */ }
    try {
      const saved = sessionStorage.getItem('discover-enrichment-resume');
      if (saved) {
        const parsed = JSON.parse(saved) as { ids: string[]; blocked: boolean };
        if (Array.isArray(parsed.ids) && parsed.ids.every(id => typeof id === 'string')) {
          setResumeIds(parsed.ids); setResumeBlocked(parsed.blocked === true);
        }
      }
    } catch { /* invalid local recovery state */ }
  }, []);
  useEffect(() => {
    if (pendingQuote) sessionStorage.setItem('discover-enrichment-pending-quote', JSON.stringify(pendingQuote));
    else sessionStorage.removeItem('discover-enrichment-pending-quote');
  }, [pendingQuote]);
  useEffect(() => {
    if (resumeIds.length) sessionStorage.setItem('discover-enrichment-resume', JSON.stringify({ ids: resumeIds, blocked: resumeBlocked }));
    else sessionStorage.removeItem('discover-enrichment-resume');
  }, [resumeIds, resumeBlocked]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: String(page), limit: "20",
        sort: sort, order: sort === "score" ? "desc" : "asc",
      });
      if (search.trim()) p.set("search", search.trim());
      if (selectedIcp) p.set("icpId", selectedIcp);
      else if (selectedNiche) p.set("nicheId", selectedNiche);
      const res = await fetch(`/api/contacts?${p.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setContacts(json.data ?? []);
        setPag(json.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 });
      }
    } catch { /* network error */ } finally { setLoading(false); }
  }, [page, search, sort, selectedNiche, selectedIcp]);

  useEffect(() => { setPage(1); }, [selectedNiche, selectedIcp, selectedOfferings, search, sort]);
  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (contacts.length === 0) return;
    const all = contacts.every((c) => selected.has(c.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of contacts) {
        if (all) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });
  }

  async function scoreContact(contactId: string) {
    setScoring((prev) => new Set(prev).add(contactId));
    try {
      await fetch("/api/scoring/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      await fetchContacts();
    } catch { /* silent */ } finally {
      setScoring((prev) => { const n = new Set(prev); n.delete(contactId); return n; });
    }
  }

  async function handleBulkScore() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkScoring(true);
    try {
      await fetch("/api/scoring/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      await fetchContacts();
    } catch { /* silent */ } finally { setBulkScoring(false); }
  }

  async function handleBulkEnrich() {
    const ids = pendingQuote?.ids || (resumeIds.length ? resumeIds : [...selected]);
    if (ids.length === 0) return;
    setBulkEnriching(true);
    try {
      let confirmed = pendingQuote;
      if (!confirmed) {
        const estimateResponse = await fetch('/api/enrichment/estimate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: ids }),
        });
        if (!estimateResponse.ok) throw new Error('Could not estimate enrichment cost');
        const { data: estimate } = await estimateResponse.json() as { data: {
        totalCostCents: number; budgetRemaining: number; withinBudget: boolean;
        quote: string;
        } };
        if (!estimate.withinBudget) {
          alert(`Insufficient enrichment budget. Worst-case expected spend: $${(estimate.totalCostCents / 100).toFixed(2)}; remaining: $${(estimate.budgetRemaining / 100).toFixed(2)}.`);
          return;
        }
        if (!confirm(`Enrich ${ids.length} contacts? Worst-case expected spend: $${(estimate.totalCostCents / 100).toFixed(2)}. Remaining budget: $${(estimate.budgetRemaining / 100).toFixed(2)}. A preview may cost money even if you do not apply the data.`)) return;
        confirmed = { ids, quote: estimate.quote };
        sessionStorage.setItem('discover-enrichment-pending-quote', JSON.stringify(confirmed));
        setPendingQuote(confirmed);
      }
      setEnriching(new Set(ids));
      const response = await fetch("/api/enrichment/enrich", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids, quote: confirmed.quote }),
      });
      if (!response.ok) throw new Error('Enrichment result is not ready. Use Recover paid result with this same quote; do not start a new paid preview.');
      const outcome = await response.json();
      if (outcome.running) {
        setPreviewStop(outcome.message || 'Provider request is still running. Recover this same quote later.');
        return;
      }
      if (outcome.noCharge) {
        setPendingQuote(null);
        setResumeIds(ids);
        setResumeBlocked(false);
        setPreviewStop('No provider call was made. Review a fresh estimate to continue.');
        return;
      }
      setBulkPreview(outcome.data || []);
      setPreviewStop(outcome.partial ? `${outcome.stopReason}; spent $${((outcome.totalCostCents || 0) / 100).toFixed(2)}, reserved exposure $${((outcome.reservedBudgetCents || 0) / 100).toFixed(2)}` : null);
      const remaining = outcome.partial ? remainingBulkContactIds(ids, outcome.data || []) : [];
      setResumeIds(remaining);
      setResumeBlocked(!!outcome.reconciliationRequired);
      if (!outcome.data?.length) setPendingQuote(null);
      await fetchContacts();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Enrichment failed');
    } finally { setBulkEnriching(false); setEnriching(new Set()); }
  }

  async function applyBulkPreview() {
    setApplyingPreview(true);
    try {
      for (const item of bulkPreview) {
        const fields = item.delta.filter(field => field.selected && field.newValue !== null)
          .map(field => ({ field: field.field, value: field.newValue! }));
        if (fields.length) {
          const response = await fetch('/api/enrichment/apply', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              contactId: item.contactId, fields, quote: pendingQuote?.quote,
            }) });
          if (!response.ok) throw new Error(`Could not apply reviewed fields for ${item.contactId}`);
        }
        setBulkPreview(previous => previous.filter(entry => entry.contactId !== item.contactId));
        setSelected(previous => new Set([...previous].filter(id => id !== item.contactId)));
      }
      setPendingQuote(null);
      setPreviewStop(null);
      setSelected(new Set(resumeIds));
      await fetchContacts();
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not apply preview'); }
    finally { setApplyingPreview(false); }
  }

  async function checkChargeReconciliation() {
    try {
      const response = await fetch('/api/enrichment/reconcile');
      if (!response.ok) throw new Error('Could not check charge reconciliation');
      const payload = await response.json() as { data: Array<{ contactId: string }> };
      if (payload.data.some(item => resumeIds.includes(item.contactId))) {
        alert('A charge for a remaining contact still needs invoice reconciliation.');
        return;
      }
      setResumeBlocked(false);
    } catch { alert('Could not check charge reconciliation'); }
  }

  async function handleExpandNetwork() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const selectedContacts = contacts.filter((c) => ids.includes(c.id));
    const names = selectedContacts.map((c) => c.fullName || c.firstName || "Unknown").join(", ");
    if (!confirm(`Create tasks to find 2nd-degree contacts for ${ids.length} people?\n\n${names}`)) return;
    setExpanding(true);
    try {
      for (const c of selectedContacts) {
        const name = c.fullName || c.firstName || "Unknown";
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Expand network: find 2nd-degree contacts for ${name}`,
            description: `Search LinkedIn for mutual connections and 2nd-degree contacts of ${name} (${c.title || ""} at ${c.currentCompany || ""}). Look for people who could be warm introductions or share the same niche.`,
            taskType: "expand_network",
            contactId: c.id,
            priority: 3,
            url: `https://www.linkedin.com/search/results/people/?network=%5B%22S%22%5D&origin=MEMBER_PROFILE_CANNED_SEARCH`,
            metadata: { sourceAction: "discover-expand", contactName: name },
          }),
        });
      }
      alert(`Created ${ids.length} network expansion task${ids.length !== 1 ? "s" : ""}. Check the Tasks page.`);
    } catch {
      alert("Failed to create tasks");
    } finally {
      setExpanding(false);
    }
  }

  const allOnPage = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const selCount = selected.size;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          People
          {pag.total > 0 && <span className="text-muted-foreground font-normal ml-1">({pag.total})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 pt-0">
        {/* Search + Sort */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..." className="h-8 pl-8 text-xs" />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortField)}>
            <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="company">Company</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk actions */}
        {(selCount > 0 || pendingQuote || resumeIds.length > 0) && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{selCount} selected{resumeIds.length > 0 ? ` · ${resumeIds.length} awaiting resume` : ''}</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkScore} disabled={bulkScoring}>
              {bulkScoring ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Score
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleBulkEnrich} disabled={bulkEnriching || bulkPreview.length > 0}>
              {bulkEnriching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
              {pendingQuote ? 'Recover paid result' : resumeIds.length ? 'Quote remaining contacts' : 'Enrich'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExpandNetwork} disabled={expanding}>
              {expanding ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Users className="h-3 w-3 mr-1" />}
              Expand Network
            </Button>
          </div>
        )}

        {previewStop && bulkPreview.length === 0 && <p role="status" className="text-xs rounded-md border p-2">{previewStop}</p>}

        {resumeIds.length > 0 && !pendingQuote && <p role="status" className="text-xs rounded-md border p-2">
          {resumeBlocked ? 'Reconcile the unknown charge on the Enrichment page before quoting remaining contacts.'
            : 'The partial batch is saved. Quote the remaining contacts to resume; any paid request requires a new confirmation.'}
          {resumeBlocked && <Link href="/enrichment" className="ml-1 underline">Open charge reconciliation</Link>}
          {resumeBlocked && <button type="button" className="ml-2 underline" onClick={checkChargeReconciliation}>Check reconciliation</button>}
        </p>}

        {bulkPreview.length > 0 && (
          <div className="rounded-md border p-3 text-xs space-y-2" role="region" aria-label="Paid enrichment review">
            <p className="font-medium">Review paid enrichment before applying or clearing selection</p>
            {previewStop && <p role="alert">Stopped: {previewStop}. {resumeBlocked ? 'Reconcile the unknown charge before another paid preview.' : 'Review saved fields, then quote the remaining contacts.'}</p>}
            {bulkPreview.map(item => (
              <div key={item.contactId} className="space-y-1">
                <p>{nameOf(contacts.find(c => c.id === item.contactId) || { id: item.contactId } as Contact)} — spent ${(item.totalCostCents / 100).toFixed(2)}</p>
                {item.delta.length === 0 && <p className="text-muted-foreground">No fields returned.</p>}
                {item.delta.map(field => (
                  <label key={`${item.contactId}-${field.field}`} className="flex gap-2 items-center">
                    <input type="checkbox" checked={field.selected} onChange={() => setBulkPreview(previous => previous.map(entry =>
                      entry.contactId === item.contactId ? { ...entry, delta: entry.delta.map(value =>
                        value.field === field.field ? { ...value, selected: !value.selected } : value) } : entry))} />
                    {field.label}: {field.oldValue || 'empty'} → {field.newValue}
                  </label>
                ))}
              </div>
            ))}
            <Button size="sm" onClick={applyBulkPreview} disabled={applyingPreview}>{applyingPreview ? 'Applying…' : 'Apply reviewed fields and clear selection'}</Button>
          </div>
        )}

        {/* Table / states */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /><span className="text-xs">Loading...</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center">No contacts found. Import contacts or adjust filters.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={allOnPage} onClick={toggleSelectAll} label="Select all" /></TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Title</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Company</TableHead>
                  <TableHead className="text-xs w-16">Tier</TableHead>
                  <TableHead className="text-xs w-16 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Checkbox checked={selected.has(c.id)} onClick={() => toggleSelect(c.id)} label={`Select ${nameOf(c)}`} /></TableCell>
                    <TableCell>
                      <ContactTooltip contactId={c.id}>
                        <Link href={`/contacts/${c.id}`} className="text-xs font-medium hover:underline text-primary">{nameOf(c)}</Link>
                      </ContactTooltip>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[120px] hidden sm:table-cell">{c.title || "\u2014"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[120px] hidden md:table-cell">{c.currentCompany || "\u2014"}</TableCell>
                    <TableCell><TierBadge tier={c.tier} score={c.compositeScore} showScore /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => scoreContact(c.id)} disabled={scoring.has(c.id) || enriching.has(c.id)} title="Score contact">
                          {scoring.has(c.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        </Button>
                        <Link href={`/contacts/${c.id}`}>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="View contact"><ExternalLink className="h-3 w-3" /></Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {pag.totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
              <ChevronLeft className="h-3 w-3 mr-1" />Prev
            </Button>
            <span className="text-xs text-muted-foreground">Page {pag.page} of {pag.totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPage((p) => Math.min(pag.totalPages, p + 1))} disabled={page >= pag.totalPages || loading}>
              Next<ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
