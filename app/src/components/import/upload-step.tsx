"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, X, FileText, CheckCircle, AlertCircle } from "lucide-react";
import { uploadFiles, startImport } from "@/lib/api/import";
import { useImportStatus } from "@/lib/hooks/use-import";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadStep() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { session } = useImportStatus(sessionId);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const csvFiles = Array.from(newFiles).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    if (csvFiles.length === 0) {
      setUploadError("Only CSV files are accepted.");
      return;
    }
    setUploadError(null);
    setFiles((prev) => [...prev, ...csvFiles]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadFiles(files);
      await startImport(result.sessionId);
      setSessionId(result.sessionId);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  };

  if (session) {
    const isCompleted = session.status === "completed";
    const isFailed = session.status === "failed";
    const progress =
      session.totalRecords > 0
        ? Math.round(
            (session.processedRecords / session.totalRecords) * 100
          )
        : 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          {isCompleted ? (
            <CheckCircle className="h-6 w-6 text-green-500" />
          ) : isFailed ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          )}
          <h3 className="text-lg font-medium">
            {isCompleted
              ? "Import Complete"
              : isFailed
                ? "Import Failed"
                : "Importing..."}
          </h3>
        </div>

        {!isFailed && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground">
              {session.processedRecords} / {session.totalRecords} records
              processed
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{session.newRecords}</p>
            <p className="text-xs text-muted-foreground">New</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{session.updatedRecords}</p>
            <p className="text-xs text-muted-foreground">Updated</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{session.skippedRecords}</p>
            <p className="text-xs text-muted-foreground">Skipped</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{session.erroredRecords}</p>
            <p className="text-xs text-muted-foreground">Errors</p>
          </div>
        </div>

        {isFailed && session.error && (
          <p className="text-sm text-destructive">{session.error}</p>
        )}

        {isCompleted && (
          <Button onClick={() => router.push("/contacts")}>
            View Contacts
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <Upload className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
        <p className="mb-2 text-sm font-medium">
          Drag and drop CSV files here, or{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => fileInputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-muted-foreground">
          Supports LinkedIn connection exports (.csv)
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({formatFileSize(file.size)})
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => removeFile(i)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {uploadError && (
        <p className="text-sm text-destructive">{uploadError}</p>
      )}

      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
      >
        {uploading ? "Uploading..." : "Upload & Import"}
      </Button>
    </div>
  );
}
