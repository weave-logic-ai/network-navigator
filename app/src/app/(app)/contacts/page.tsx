import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload } from "lucide-react";

const ContactsTable = dynamic(
  () =>
    import("@/components/contacts/contacts-table").then(
      (mod) => mod.ContactsTable
    ),
  {
    loading: () => (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    ),
  }
);

export default function ContactsPage() {
  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Manage your LinkedIn contacts"
        actions={
          <Link href="/import">
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          </Link>
        }
      />
      <ContactsTable />
    </div>
  );
}
