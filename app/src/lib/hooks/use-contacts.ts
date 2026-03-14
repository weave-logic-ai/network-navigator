"use client";

import useSWR from "swr";
import { buildContactsUrl } from "@/lib/api/contacts";
import type { Contact, ContactListParams } from "@/lib/types/contact";
import type { PaginatedResponse } from "@/lib/types/api";

export function useContacts(params: ContactListParams = {}) {
  const url = buildContactsUrl(params);
  const { data, error, isLoading, mutate } =
    useSWR<PaginatedResponse<Contact>>(url, {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      refreshInterval: 30000,
    });

  return {
    contacts: data?.data ?? [],
    pagination: data?.pagination ?? {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    },
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function useContact(id: string | null) {
  const { data, error, isLoading } = useSWR<Contact>(
    id ? `/api/contacts/${id}` : null
  );

  return {
    contact: data ?? null,
    isLoading,
    isError: !!error,
    error,
  };
}
