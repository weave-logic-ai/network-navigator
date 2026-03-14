import dynamic from "next/dynamic";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

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
        description="Upload CSV exports from LinkedIn to import your contacts"
      />
      <ImportWizard />
    </div>
  );
}
