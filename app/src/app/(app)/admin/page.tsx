"use client";

import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoringTab } from "@/components/admin/scoring-tab";
import { HealthTab } from "@/components/admin/health-tab";
import { DataTab } from "@/components/admin/data-tab";

export default function AdminPage() {
  return (
    <div>
      <PageHeader
        title="Admin"
        description="Scoring weights, system health, and data management"
      />

      <Tabs defaultValue="scoring" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scoring">Scoring Weights</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="data">Data Management</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring" className="space-y-4">
          <ScoringTab />
        </TabsContent>

        <TabsContent value="health" className="space-y-4">
          <HealthTab />
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <DataTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
