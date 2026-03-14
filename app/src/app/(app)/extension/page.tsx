import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ExtensionPage() {
  return (
    <div>
      <PageHeader title="Extension" />
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">
            Extension management coming in Phase 4
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
