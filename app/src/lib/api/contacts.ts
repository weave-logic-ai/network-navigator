import { apiGet } from "./client";
import type { Contact, ContactListParams } from "@/lib/types/contact";
import type { PaginatedResponse } from "@/lib/types/api";

export function buildContactsUrl(params: ContactListParams = {}): string {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.sortBy) searchParams.set("sort_by", params.sortBy);
  if (params.sortOrder) searchParams.set("sort_order", params.sortOrder);
  if (params.search) searchParams.set("search", params.search);
  if (params.tier) searchParams.set("tier", params.tier);
  if (params.enrichmentStatus)
    searchParams.set("enrichment_status", params.enrichmentStatus);

  const qs = searchParams.toString();
  return `/api/contacts${qs ? `?${qs}` : ""}`;
}

export async function fetchContacts(
  params: ContactListParams = {}
): Promise<PaginatedResponse<Contact>> {
  const url = buildContactsUrl(params);
  return apiGet<PaginatedResponse<Contact>>(url);
}

export async function fetchContact(id: string): Promise<Contact> {
  return apiGet<Contact>(`/api/contacts/${id}`);
}

export async function searchContacts(
  query: string
): Promise<PaginatedResponse<Contact>> {
  return apiGet<PaginatedResponse<Contact>>(
    `/api/contacts/search?q=${encodeURIComponent(query)}`
  );
}
