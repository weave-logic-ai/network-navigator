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
}

interface BudgetData {
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

  useEffect(() => {
    async function load() {
      try {
        const [providersRes, budgetRes, historyRes] = await Promise.all([
          fetch("/api/enrichment/providers"),
          fetch("/api/enrichment/budget"),
          fetch("/api/enrichment/history?limit=20"),
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
      setToggling(provider.id);
      try {
        const res = await fetch(`/api/enrichment/providers/${provider.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !provider.isActive }),
        });
        if (res.ok) {
          setProviders((prev) =>
            prev.map((p) =>
              p.id === provider.id
                ? { ...p, isActive: !provider.isActive }
                : p
            )
          );
        }
      } catch {
        // ignore
      } finally {
        setToggling(null);
      }
    },
    []
  );

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

  return (
    <div>
      <PageHeader
        title="Enrichment"
        description="Manage data enrichment providers and budget"
      />

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
                      disabled={toggling === provider.id}
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
            {!budget || budget.budgetCents === 0 ? (
              <p className="text-sm text-muted-foreground">
                No budget period configured. Create a budget period to track
                enrichment spend.
              </p>
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
