import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function TasksPage() {
  return (
    <div>
      <PageHeader title="Tasks" />
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Task management coming in Phase 5
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
