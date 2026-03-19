import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const ScoreScatterWidget = dynamic(
  () =>
    import("@/components/dashboard/score-scatter-widget").then(
      (mod) => mod.ScoreScatterWidget
    ),
  { loading: () => <ChartSkeleton title="Score Distribution" /> }
);

const GoalFocusBanner = dynamic(
  () =>
    import("@/components/dashboard/goal-focus-banner").then(
      (mod) => mod.GoalFocusBanner
    ),
  { loading: () => <BannerSkeleton /> }
);

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

const IcpRadarChart = dynamic(
  () =>
    import("@/components/dashboard/icp-radar-chart").then(
      (mod) => mod.IcpRadarChart
    ),
  { loading: () => <ChartSkeleton title="ICP Dimensions" /> }
);

const TaskQueueWidget = dynamic(
  () =>
    import("@/components/dashboard/task-queue-widget").then(
      (mod) => mod.TaskQueueWidget
    ),
  { loading: () => <ChartSkeleton title="Task Queue" /> }
);

const DiscoveryFeed = dynamic(
  () =>
    import("@/components/dashboard/discovery-feed").then(
      (mod) => mod.DiscoveryFeed
    ),
  { loading: () => <ChartSkeleton title="Discovery Feed" /> }
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

function BannerSkeleton() {
  return (
    <Card>
      <CardContent className="py-4">
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

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
      <div className="space-y-4">
        <GoalFocusBanner />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <NetworkHealthRing />
          <TierDistributionChart />
          <EnrichmentBudgetBars />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <IcpRadarChart />
          <TaskQueueWidget />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ScoreScatterWidget />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <DiscoveryFeed />
          <TopContactsList />
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
