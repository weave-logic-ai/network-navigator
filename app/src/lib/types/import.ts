export interface ImportFile {
  id: string;
  fileName: string;
  fileSize: number;
  status: "pending" | "processing" | "completed" | "failed";
  recordsTotal: number;
  recordsProcessed: number;
  recordsNew: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsErrored: number;
}

export interface ImportSession {
  sessionId: string;
  status: "pending" | "uploading" | "processing" | "completed" | "failed";
  files: ImportFile[];
  totalFiles: number;
  processedFiles: number;
  totalRecords: number;
  processedRecords: number;
  newRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  erroredRecords: number;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}
