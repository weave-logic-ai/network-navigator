import type { Contact } from "@/lib/types/contact";

export interface ColumnDef {
  key: string;
  label: string;
  width: string;
  sortable: boolean;
  accessor: (contact: Contact) => string | number | null | undefined;
}

export const columns: ColumnDef[] = [
  {
    key: "fullName",
    label: "Name",
    width: "200px",
    sortable: true,
    accessor: (c) => c.fullName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown",
  },
  {
    key: "title",
    label: "Title / Company",
    width: "250px",
    sortable: false,
    accessor: (c) => c.title,
  },
  {
    key: "compositeScore",
    label: "Score",
    width: "80px",
    sortable: true,
    accessor: (c) => c.compositeScore ?? 0,
  },
  {
    key: "tier",
    label: "ICP Fit",
    width: "100px",
    sortable: true,
    accessor: (c) => c.tier,
  },
  {
    key: "enrichmentStatus",
    label: "Enrichment",
    width: "120px",
    sortable: false,
    accessor: (c) => c.enrichmentStatus,
  },
  {
    key: "outreachState",
    label: "Outreach",
    width: "120px",
    sortable: false,
    accessor: (c) => c.outreachState,
  },
];
