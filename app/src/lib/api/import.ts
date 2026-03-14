import { apiGet, apiPost } from "./client";
import type { ImportSession } from "@/lib/types/import";
import type { PaginatedResponse } from "@/lib/types/api";

export async function uploadFiles(
  files: File[]
): Promise<{ sessionId: string; files: string[] }> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return apiPost<{ sessionId: string; files: string[] }>(
    "/api/import/upload",
    formData
  );
}

export async function startImport(
  sessionId: string
): Promise<{ sessionId: string; status: string }> {
  return apiPost<{ sessionId: string; status: string }>("/api/import/csv", {
    sessionId,
  });
}

export async function fetchImportStatus(
  sessionId: string
): Promise<ImportSession> {
  return apiGet<ImportSession>(`/api/import/status/${sessionId}`);
}

export async function fetchImportHistory(): Promise<
  PaginatedResponse<ImportSession>
> {
  return apiGet<PaginatedResponse<ImportSession>>("/api/import/history");
}
