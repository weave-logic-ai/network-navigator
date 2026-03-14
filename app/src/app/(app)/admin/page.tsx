import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin" />
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Admin panel coming in Phase 6
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
