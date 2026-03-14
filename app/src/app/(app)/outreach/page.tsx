import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function OutreachPage() {
  return (
    <div>
      <PageHeader title="Outreach" />
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Outreach pipeline coming in Phase 5
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
