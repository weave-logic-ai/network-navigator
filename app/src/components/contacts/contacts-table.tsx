"use client";

import { useCallback, useState } from "react";
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

const REFERRAL_BADGES: Record<string, { label: string; className: string }> = {
  "gold-referral": { label: "Gold referral", className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400" },
  "silver-referral": { label: "Silver referral", className: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800/30 dark:text-gray-400" },
  "bronze-referral": { label: "Bronze referral", className: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400" },
  "watch-referral": { label: "Watch referral", className: "bg-muted text-muted-foreground border-muted" },
};

export function ContactsTable() {
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
      page: 1,
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

  if (!isLoading && contacts.length === 0 && !params.search && !params.tier && !params.enrichmentStatus && !params.campaignId) {
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
            enrichmentStatus: status === "has_data" || status === "no_data"
              ? status : undefined,
          })
        }
        campaignId={params.campaignId ?? ""}
        onCampaignChange={(campaignId) => updateParams({ campaignId: campaignId === "latest" ? undefined : campaignId })}
        onClearFilters={() =>
          updateParams({
            search: undefined,
            tier: undefined,
            enrichmentStatus: undefined,
            campaignId: undefined,
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
                  className={col.sortable ? "select-none" : ""}
                  aria-sort={col.sortable && params.sortBy === col.key
                    ? params.sortOrder === "asc" ? "ascending" : "descending"
                    : undefined}
                >
                  {col.sortable ? (
                    <button type="button" onClick={() => handleSort(col.key)} className="flex items-center gap-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                      {col.key === "tier" ? "Tier" : col.key === "compositeScore" ? "Score /100" : col.label}
                      <ArrowUpDown aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
                    </button>
                  ) : col.key === "outreachStage" && params.campaignId
                    ? "Outreach stage (selected campaign)" : col.label}
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
              : contacts.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                    No contacts match these filters. Clear the filters to see all contacts.
                  </TableCell></TableRow>
                ) : contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">
                      <Link href={`/contacts/${contact.id}`} className="underline-offset-2 hover:underline focus-visible:underline">
                        {contact.fullName ||
                        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
                        "Unknown"}
                      </Link>
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
                      {contact.compositeScore == null
                        ? <span className="text-muted-foreground">Unknown</span>
                        : Math.round(contact.compositeScore * 100)}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={contact.tier} />
                    </TableCell>
                    <TableCell>
                      {contact.referralTier && REFERRAL_BADGES[contact.referralTier] ? (
                        <Badge variant="outline" className={`text-xs whitespace-nowrap ${REFERRAL_BADGES[contact.referralTier].className}`}>
                          {REFERRAL_BADGES[contact.referralTier].label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          contact.enrichmentStatus === "has_data"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {contact.enrichmentStatus === "has_data"
                          ? "Lookup data found"
                          : contact.enrichmentStatus === "no_data" ? "No lookup data" : "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {contact.outreachStage ?? "No outreach"}
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
