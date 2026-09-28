"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Linkedin, Plug, PlugZap } from "lucide-react";

interface ProviderData {
  id: string;
  name: string;
  displayName: string;
  isActive: boolean;
  costPerLookupCents: number;
  capabilities: string[];
  priority: number;
  credentialConfigured: boolean;
  canActivate: boolean;
  setupMessage: string;
}

interface BudgetData {
  currentPeriod: { periodEnd: string } | null;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  utilizationPercent: number;
  isWarning: boolean;
  isExhausted: boolean;
  lookupCount: number;
}

interface TransactionData {
  id: string;
  providerId: string;
  contactId: string | null;
  costCents: number;
  status: string;
  fieldsReturned: string[];
  createdAt: string;
}

interface PendingCharge {
  quoteId: string;
  contactId: string;
  provider: string;
  reservedCents: number;
  createdAt: string;
}

const CAPABILITY_COLORS: Record<string, string> = {
  profile: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  employment:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  education:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  skills:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  connections:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  activity:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  email: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  phone:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  social: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  company: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200",
  technographics:
    "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  funding:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  leadership:
    "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  website: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function getCapabilityClass(cap: string): string {
  return (
    CAPABILITY_COLORS[cap] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
  );
}

export default function EnrichmentPage() {
  const [providers, setProviders] = useState<ProviderData[]>([]);
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [budgetDollars, setBudgetDollars] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingCharges, setPendingCharges] = useState<PendingCharge[]>([]);
  const [chargeInputs, setChargeInputs] = useState<Record<string, { cents: string; reference: string }>>({});
  const [settlingCharge, setSettlingCharge] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [providersRes, budgetRes, historyRes, chargesRes] = await Promise.all([
          fetch("/api/enrichment/providers"),
          fetch("/api/enrichment/budget"),
          fetch("/api/enrichment/history?limit=20"),
          fetch("/api/enrichment/reconcile"),
        ]);

        if (providersRes.ok) {
          const json = await providersRes.json();
          setProviders(json.data || []);
        }

        if (budgetRes.ok) {
          const json = await budgetRes.json();
          setBudget(json.data);
        }

        if (historyRes.ok) {
          const json = await historyRes.json();
          setTransactions(json.data || []);
        }
        if (chargesRes.ok) setPendingCharges((await chargesRes.json()).data || []);
      } catch {
        // Empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const toggleProvider = useCallback(
    async (provider: ProviderData) => {
      setMessage("");
      setToggling(provider.id);
      try {
        const res = await fetch(`/api/enrichment/providers/${provider.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !provider.isActive }),
        });
        if (res.ok) {
          const json = await res.json();
          setProviders((prev) =>
            prev.map((p) =>
              p.id === provider.id
                ? json.data
                : p
            )
          );
        } else {
          const json = await res.json();
          setMessage(json.error || "Could not update provider.");
        }
      } catch {
        setMessage("Could not update provider. Try again.");
      } finally {
        setToggling(null);
      }
    },
    []
  );

  async function saveApiKey(provider: ProviderData) {
    setMessage("");
    setToggling(provider.id);
    try {
      const res = await fetch(`/api/enrichment/providers/${provider.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeys[provider.id] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save API key.");
      setProviders(prev => prev.map(p => p.id === provider.id ? json.data : p));
      setApiKeys(prev => ({ ...prev, [provider.id]: "" }));
      setMessage(`${provider.displayName} credential saved locally. It has not been tested against the provider.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save API key.");
    } finally { setToggling(null); }
  }

  async function settleCharge(charge: PendingCharge) {
    const input = chargeInputs[charge.quoteId];
    const cents = Number(input?.cents);
    if (!input?.cents || !Number.isSafeInteger(cents) || cents < 0 || cents > charge.reservedCents
      || !input.reference?.trim()) {
      setMessage("Enter the verified billed cents (up to the reservation) and invoice reference.");
      return;
    }
    if (!confirm(`Settle ${charge.provider} for ${charge.contactId} at $${(cents / 100).toFixed(2)} against invoice ${input.reference.trim()}? This records the bill and releases unused reservation. It does not repeat the provider call.`)) return;
    setSettlingCharge(charge.quoteId);
    try {
      const response = await fetch('/api/enrichment/reconcile', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: charge.quoteId, billedCents: cents, invoiceReference: input.reference.trim() }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Reconciliation failed');
      setPendingCharges(previous => previous.filter(item => item.quoteId !== charge.quoteId));
      setMessage('Charge reconciled. Recover the original quote to review saved fields; a new paid preview needs a new quote.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Reconciliation failed'); }
    finally { setSettlingCharge(null); }
  }

  async function createBudget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(budgetDollars)) {
      setMessage("Enter a dollar amount with at most two decimal places.");
      return;
    }
    const budgetCents = Math.round(Number(budgetDollars) * 100);
    if (!Number.isSafeInteger(budgetCents) || budgetCents < 1 || budgetCents > 100000000) {
      setMessage("Enter an amount from $0.01 to $1,000,000.");
      return;
    }
    setSavingBudget(true);
    try {
      const res = await fetch("/api/enrichment/budget", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetCents }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create budget.");
      setBudget(json.data);
      setBudgetDollars("");
      setMessage("Monthly budget created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create budget.");
    } finally { setSavingBudget(false); }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Enrichment" />
        <div className="h-48 flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  // Separate LinkedIn provider from API providers
  const linkedinProvider = providers.find((p) => p.name === "linkedin");
  const apiProviders = providers.filter((p) => p.name !== "linkedin");
  const expectedPerContactCents = apiProviders
    .filter(p => p.isActive && p.canActivate)
    .reduce((sum, p) => sum + p.costPerLookupCents, 0);

  return (
    <div>
      <PageHeader
        title="Enrichment"
        description="Manage data enrichment providers and budget"
      />
      {message && <p role="status" className="mb-4 rounded-md border p-3 text-sm">{message}</p>}
      {pendingCharges.length > 0 && <Card className="mb-6">
        <CardHeader><CardTitle>Charges requiring reconciliation</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>Check the provider invoice before entering an amount. Keep uncertain charges blocked. Saved fields remain on the original quote.</p>
          {pendingCharges.map(charge => <div key={charge.quoteId} className="rounded-md border p-3 space-y-2">
            <p>{charge.provider} · contact {charge.contactId} · reserved ${(charge.reservedCents / 100).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Quote {charge.quoteId} · {new Date(charge.createdAt).toLocaleString()}</p>
            <div className="flex flex-wrap gap-2">
              <input aria-label={`Verified billed cents for ${charge.quoteId}`} type="number" min="0" max={charge.reservedCents}
                placeholder="Billed cents" className="rounded-md border px-2 py-1" value={chargeInputs[charge.quoteId]?.cents || ''}
                onChange={event => setChargeInputs(previous => ({ ...previous, [charge.quoteId]: {
                  cents: event.target.value, reference: previous[charge.quoteId]?.reference || '' } }))} />
              <input aria-label={`Invoice reference for ${charge.quoteId}`} placeholder="Invoice/reference"
                className="rounded-md border px-2 py-1" value={chargeInputs[charge.quoteId]?.reference || ''}
                onChange={event => setChargeInputs(previous => ({ ...previous, [charge.quoteId]: {
                  cents: previous[charge.quoteId]?.cents || '', reference: event.target.value } }))} />
              <button type="button" className="rounded-md border px-3 py-1" disabled={settlingCharge === charge.quoteId}
                onClick={() => settleCharge(charge)}>Record verified charge</button>
            </div>
          </div>)}
        </CardContent>
      </Card>}

      {/* LinkedIn Extension Provider - Featured Card */}
      {linkedinProvider && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">LinkedIn Extension</h2>
          <Card className="border-blue-200 dark:border-blue-900">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                    <Linkedin className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      {linkedinProvider.displayName}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Free enrichment via browser extension
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="text-green-700 border-green-300 dark:text-green-400 dark:border-green-800"
                  >
                    Free
                  </Badge>
                  <Switch
                    checked={linkedinProvider.isActive}
                    disabled={toggling === linkedinProvider.id}
                    onCheckedChange={() => toggleProvider(linkedinProvider)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Data point tags */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Data Points
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {linkedinProvider.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getCapabilityClass(cap)}`}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Extension connection status */}
                <div className="flex items-center gap-2 rounded-md border p-3">
                  {linkedinProvider.isActive ? (
                    <>
                      <PlugZap className="h-4 w-4 text-green-500" />
                      <span className="text-sm">
                        Extension enabled — will enrich contacts when browsing
                        LinkedIn
                      </span>
                    </>
                  ) : (
                    <>
                      <Plug className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Enable to start enriching contacts via the browser
                        extension
                      </span>
                    </>
                  )}
                </div>

                {!linkedinProvider.isActive && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      The Chrome extension scrapes profile data when you browse
                      LinkedIn and sends it to ctox for enrichment.
                    </p>
                    <p>
                      Install the extension from{" "}
                      <code className="rounded bg-muted px-1 py-0.5">
                        browser/
                      </code>{" "}
                      and enable this provider to start.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* API Provider Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">API Providers</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Expected spend for one contact: up to ${(expectedPerContactCents / 100).toFixed(2)}
          {" "}with the currently active paid providers. A preview may cost money even if you do not apply the returned data.
        </p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {apiProviders.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    {provider.displayName}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={provider.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {provider.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Switch
                      checked={provider.isActive}
                      disabled={toggling === provider.id || (!provider.isActive && !provider.canActivate)}
                      aria-label={`${provider.isActive ? "Disable" : "Enable"} ${provider.displayName}`}
                      onCheckedChange={() => toggleProvider(provider)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Cost per lookup
                    </span>
                    <span>
                      ${(provider.costPerLookupCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {provider.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getCapabilityClass(cap)}`}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{provider.setupMessage}</p>
                  {['pdl', 'lusha', 'theirstack', 'apollo'].includes(provider.name) && (
                    <div className="flex gap-2">
                      <input
                        type="password" autoComplete="off"
                        aria-label={`${provider.displayName} API key`}
                        placeholder={provider.credentialConfigured ? "Replace API key" : "API key"}
                        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                        value={apiKeys[provider.id] || ""}
                        onChange={event => setApiKeys(prev => ({ ...prev, [provider.id]: event.target.value }))}
                      />
                      <button type="button" className="rounded-md border px-2 text-xs"
                        disabled={toggling === provider.id || !apiKeys[provider.id]?.trim()}
                        onClick={() => saveApiKey(provider)}>Save key</button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Budget Progress */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Budget</h2>
        <Card>
          <CardContent className="p-6">
            {!budget?.currentPeriod ? (
              <form onSubmit={createBudget} className="space-y-3">
                <p className="text-sm">No active budget. Paid enrichment is blocked until you create one.</p>
                <label className="block text-sm" htmlFor="monthly-budget">Monthly budget (USD)</label>
                <div className="flex gap-2">
                  <input id="monthly-budget" inputMode="decimal" placeholder="25.00"
                    value={budgetDollars} onChange={event => setBudgetDollars(event.target.value)}
                    className="w-36 rounded-md border bg-background px-2 py-1 text-sm" />
                  <button type="submit" disabled={savingBudget} className="rounded-md border px-3 text-sm">
                    {savingBudget ? "Creating…" : "Create budget"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Valid through the end of this month. Preview may cost money; review the expected spend before requesting paid data.</p>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    ${(budget.spentCents / 100).toFixed(2)} spent of $
                    {(budget.budgetCents / 100).toFixed(2)}
                  </span>
                  <span
                    className={`text-sm ${budget.isWarning ? "text-orange-600" : "text-muted-foreground"}`}
                  >
                    {budget.utilizationPercent.toFixed(0)}% used
                  </span>
                </div>
                <Progress value={budget.utilizationPercent} />
                <p className="text-xs text-muted-foreground">Period ends {budget.currentPeriod.periodEnd}. Preview may cost money; review the expected spend before requesting paid data.</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{budget.lookupCount} total lookups</span>
                  <span>
                    ${(budget.remainingCents / 100).toFixed(2)} remaining
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>
        <Card>
          <CardContent className="p-0">
            {transactions.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No enrichment transactions yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 font-medium">Date</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Fields</th>
                      <th className="text-right p-3 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="border-b last:border-0">
                        <td className="p-3 text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={
                              tx.status === "success" ? "default" : "secondary"
                            }
                            className="text-xs"
                          >
                            {tx.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {tx.fieldsReturned.join(", ") || "none"}
                        </td>
                        <td className="p-3 text-right">
                          ${(tx.costCents / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
