// Budget manager for enrichment spend tracking

import * as enrichmentQueries from '../db/queries/enrichment';
import { BudgetPeriod, CostEstimate } from './types';

export interface BudgetStatus {
  currentPeriod: BudgetPeriod | null;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  utilizationPercent: number;
  isWarning: boolean;
  isExhausted: boolean;
  lookupCount: number;
}

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const budget = await enrichmentQueries.getActiveBudget();

  if (!budget) {
    return {
      currentPeriod: null,
      budgetCents: 0,
      spentCents: 0,
      remainingCents: 0,
      utilizationPercent: 0,
      isWarning: false,
      isExhausted: true,
      lookupCount: 0,
    };
  }

  const remainingCents = budget.budgetCents - budget.spentCents;
  const utilizationPercent = budget.budgetCents > 0
    ? (budget.spentCents / budget.budgetCents) * 100
    : 0;

  return {
    currentPeriod: budget,
    budgetCents: budget.budgetCents,
    spentCents: budget.spentCents,
    remainingCents: Math.max(0, remainingCents),
    utilizationPercent: Math.round(utilizationPercent * 100) / 100,
    isWarning: utilizationPercent >= 80,
    isExhausted: remainingCents <= 0,
    lookupCount: budget.lookupCount,
  };
}

export async function canAfford(estimate: CostEstimate): Promise<boolean> {
  const status = await getBudgetStatus();
  if (status.isExhausted) return false;
  return estimate.totalCostCents <= status.remainingCents;
}

export async function ensureBudgetPeriod(
  periodType: string = 'monthly',
  budgetCents: number = 10000 // $100 default
): Promise<BudgetPeriod> {
  const existing = await enrichmentQueries.getActiveBudget();
  if (existing) return existing;

  const now = new Date();
  let periodStart: string;
  let periodEnd: string;

  if (periodType === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    periodStart = start.toISOString().split('T')[0];
    periodEnd = end.toISOString().split('T')[0];
  } else {
    periodStart = now.toISOString().split('T')[0];
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    periodEnd = endDate.toISOString().split('T')[0];
  }

  return enrichmentQueries.createBudgetPeriod({
    periodType,
    periodStart,
    periodEnd,
    budgetCents,
  });
}
