import { apiGet, apiPost } from "./client";
import type { ImportSession } from "@/lib/types/import";
import type { PaginatedResponse } from "@/lib/types/api";

export interface DetectedLocalData {
  found: boolean;
  directoryPath?: string;
  recognizedFiles?: { name: string; type: string }[];
  deepFiles?: { name: string; type: string }[];
  otherFiles?: string[];
  subdirectories?: string[];
  totalCsvCount?: number;
  hasFullDump?: boolean;
}

export interface DirectoryImportResult {
  totalProcessed: number;
  totalNew: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
  recognizedFiles: string[];
  skippedFiles?: string[];
}

export async function detectLocalData(): Promise<DetectedLocalData> {
  return apiGet<DetectedLocalData>("/api/import/detect-local");
}

export async function importFromDirectory(
  directoryPath: string,
  selfContactId: string,
  selfName?: string
): Promise<DirectoryImportResult> {
  return apiPost<DirectoryImportResult>("/api/import/from-directory", {
    directoryPath,
    selfContactId,
    selfName,
  });
}

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

// Full profile deep dive import

export interface FullProfileImportResult {
  profileId: string;
  version: number;
  selfName: string;
  importedFiles: string[];
  skippedFiles: string[];
  totalFiles: number;
}

export async function importFullProfile(
  directoryPath: string
): Promise<FullProfileImportResult> {
  return apiPost<FullProfileImportResult>("/api/import/full-profile", {
    directoryPath,
  });
}

export interface OwnerProfile {
  id: string;
  version: number;
  is_current: boolean;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  summary: string | null;
  industry: string | null;
  skills: string[];
  positions: Array<Record<string, string>>;
  education: Array<Record<string, string>>;
  ad_targeting: Record<string, unknown>;
  imported_files: string[];
  imported_at: string;
}

export async function fetchOwnerProfile(): Promise<OwnerProfile | null> {
  const result = await apiGet<{ data: OwnerProfile | null }>("/api/import/full-profile");
  return result.data;
}
