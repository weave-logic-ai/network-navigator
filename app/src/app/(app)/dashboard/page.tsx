import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const NetworkHealthRing = dynamic(
  () =>
    import("@/components/dashboard/network-health-ring").then(
      (mod) => mod.NetworkHealthRing
    ),
  { loading: () => <ChartSkeleton title="Network Health" /> }
);

const TierDistributionChart = dynamic(
  () =>
    import("@/components/dashboard/tier-distribution-chart").then(
      (mod) => mod.TierDistributionChart
    ),
  { loading: () => <ChartSkeleton title="Tier Distribution" /> }
);

const EnrichmentBudgetBars = dynamic(
  () =>
    import("@/components/dashboard/enrichment-budget-bars").then(
      (mod) => mod.EnrichmentBudgetBars
    ),
  { loading: () => <ChartSkeleton title="Enrichment Budget" /> }
);

const TopContactsList = dynamic(
  () =>
    import("@/components/dashboard/top-contacts-list").then(
      (mod) => mod.TopContactsList
    ),
  { loading: () => <ChartSkeleton title="Top Contacts" /> }
);

const RecentActivity = dynamic(
  () =>
    import("@/components/dashboard/recent-activity").then(
      (mod) => mod.RecentActivity
    ),
  { loading: () => <ChartSkeleton title="Recent Activity" /> }
);

function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <div className="p-6 pb-2">
        <Skeleton className="h-4 w-32" />
        <p className="text-xs text-muted-foreground mt-1">{title}</p>
      </div>
      <CardContent>
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your prospecting activity
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <NetworkHealthRing />
        <TierDistributionChart />
        <EnrichmentBudgetBars />
      </div>
      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <TopContactsList />
        <RecentActivity />
      </div>
    </div>
  );
}
