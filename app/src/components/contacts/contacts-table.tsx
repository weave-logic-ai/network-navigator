"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, ArrowUpDown } from "lucide-react";
import { useContacts } from "@/lib/hooks/use-contacts";
import { TierBadge } from "./tier-badge";
import { ContactsTableToolbar } from "./contacts-table-toolbar";
import { ContactsTablePagination } from "./contacts-table-pagination";
import { columns } from "./contacts-table-columns";
import type { ContactListParams } from "@/lib/types/contact";

export function ContactsTable() {
  const router = useRouter();
  const [params, setParams] = useState<ContactListParams>({
    page: 1,
    limit: 25,
    sortBy: "created_at",
    sortOrder: "desc",
  });

  const { contacts, pagination, isLoading, isError } = useContacts(params);

  const updateParams = useCallback(
    (updates: Partial<ContactListParams>) => {
      setParams((prev) => ({ ...prev, ...updates, page: updates.page ?? 1 }));
    },
    []
  );

  const handleSort = (key: string) => {
    setParams((prev) => ({
      ...prev,
      sortBy: key,
      sortOrder:
        prev.sortBy === key && prev.sortOrder === "asc" ? "desc" : "asc",
    }));
  };

  if (isError) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-muted-foreground">
          Unable to load contacts. The API may not be available yet.
        </p>
      </div>
    );
  }

  if (!isLoading && contacts.length === 0) {
    return (
      <div className="rounded-md border p-12 text-center">
        <p className="mb-4 text-muted-foreground">
          No contacts yet. Import your LinkedIn data to get started.
        </p>
        <Link href="/import">
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Import Contacts
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <ContactsTableToolbar
        search={params.search ?? ""}
        onSearchChange={(search) => updateParams({ search })}
        tier={params.tier ?? ""}
        onTierChange={(tier) =>
          updateParams({ tier: tier === "all" ? undefined : tier })
        }
        enrichmentStatus={params.enrichmentStatus ?? ""}
        onEnrichmentChange={(status) =>
          updateParams({
            enrichmentStatus: status === "all" ? undefined : status,
          })
        }
        onClearFilters={() =>
          updateParams({
            search: undefined,
            tier: undefined,
            enrichmentStatus: undefined,
          })
        }
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  style={{ width: col.width }}
                  className={col.sortable ? "cursor-pointer select-none" : ""}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : contacts.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/contacts/${contact.id}`)}
                  >
                    <TableCell className="font-medium">
                      {contact.fullName ||
                        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
                        "Unknown"}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{contact.title ?? "-"}</p>
                        <p className="text-xs text-muted-foreground">
                          {contact.currentCompany ?? ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {contact.compositeScore ?? 0}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={contact.tier} />
                    </TableCell>
                    <TableCell>
                      {contact.referralTier ? (
                        <TierBadge tier={contact.referralTier} />
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          contact.enrichmentStatus === "enriched"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {contact.enrichmentStatus ?? "pending"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {contact.outreachState ?? "not_started"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      <ContactsTablePagination
        page={pagination.page}
        limit={pagination.limit}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={(page) => setParams((prev) => ({ ...prev, page }))}
        onLimitChange={(limit) => updateParams({ limit })}
      />
    </div>
  );
}
