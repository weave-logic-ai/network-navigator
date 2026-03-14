"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

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

export default function EnrichmentPage() {
  const [providers, setProviders] = useState<ProviderData[]>([]);
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <PageHeader
        title="Enrichment"
        description="Manage data enrichment providers and budget"
      />

      {/* Provider Status Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Providers</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    {provider.displayName}
                  </CardTitle>
                  <Badge
                    variant={provider.isActive ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {provider.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Cost per lookup</span>
                    <span>
                      ${(provider.costPerLookupCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {provider.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-xs">
                        {cap}
                      </Badge>
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
                          {new Date(tx.createdAt).toLocaleDateString()}
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
