"use client";

import useSWR from "swr";
import type { ImportSession } from "@/lib/types/import";

export function useImportStatus(sessionId: string | null) {
  const { data, error, isLoading } = useSWR<ImportSession>(
    sessionId ? `/api/import/status/${sessionId}` : null,
    {
      refreshInterval: (latestData) => {
        if (!latestData) return 2000;
        if (
          latestData.status === "completed" ||
          latestData.status === "failed"
        ) {
          return 0;
        }
        return 2000;
      },
    }
  );

  return {
    session: data ?? null,
    isLoading,
    isError: !!error,
    error,
  };
}
