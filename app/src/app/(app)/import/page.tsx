import dynamic from "next/dynamic";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportHistory } from "./import-history";

const ImportWizard = dynamic(
  () =>
    import("@/components/import/import-wizard").then(
      (mod) => mod.ImportWizard
    ),
  {
    loading: () => <Skeleton className="h-96 w-full" />,
  }
);

export default function ImportPage() {
  return (
    <div>
      <PageHeader
        title="Import LinkedIn Data"
        description="Import supported LinkedIn CSV exports and review the outcome"
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Upload CSV files for connections, messages, invitations, endorsements, recommendations,
        positions, education, skills, and company follows. Profile.csv is accepted in the
        contacts pipeline but does not update your owner profile. A detected local LinkedIn
        export also offers a separate versioned owner profile import.
      </p>
      <ImportWizard />
      <ImportHistory />
    </div>
  );
}
