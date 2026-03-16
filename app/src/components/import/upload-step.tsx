"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  X,
  FileText,
  CheckCircle,
  AlertCircle,
  FolderOpen,
  HardDrive,
  Scan,
  ArrowRight,
  Loader2,
} from "lucide-react";
import {
  uploadFiles,
  startImport,
  detectLocalData,
  importFromDirectory,
  importFullProfile,
  type DetectedLocalData,
  type DirectoryImportResult,
  type FullProfileImportResult,
} from "@/lib/api/import";
import { useImportStatus } from "@/lib/hooks/use-import";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  connections: "Connections",
  messages: "Messages",
  invitations: "Invitations",
  endorsements: "Endorsements",
  recommendations: "Recommendations",
  positions: "Positions",
  education: "Education",
  skills: "Skills",
  company_follows: "Company Follows",
  profile: "Profile",
};

const DEEP_FILE_LABELS: Record<string, string> = {
  ad_targeting: "Ad Targeting",
  certifications: "Certifications",
  email_addresses: "Email",
  phone_numbers: "Phone",
  events: "Events",
  honors: "Honors",
  learning: "Learning",
  organizations: "Organizations",
  profile_summary: "Profile Summary",
  receipts: "Receipts",
  registration: "Registration",
  rich_media: "Rich Media",
  saved_job_alerts: "Job Alerts",
  volunteering: "Volunteering",
  projects: "Projects",
  courses: "Courses",
};

export function UploadStep() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Local directory detection
  const [localData, setLocalData] = useState<DetectedLocalData | null>(null);
  const [localImporting, setLocalImporting] = useState(false);
  const [localResult, setLocalResult] = useState<DirectoryImportResult | null>(
    null
  );

  // Full profile deep dive
  const [deepDiveImporting, setDeepDiveImporting] = useState(false);
  const [deepDiveResult, setDeepDiveResult] =
    useState<FullProfileImportResult | null>(null);

  const { session } = useImportStatus(sessionId);

  // Detect local LinkedIn data on mount
  useEffect(() => {
    detectLocalData()
      .then(setLocalData)
      .catch(() => setLocalData({ found: false }));
  }, []);

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

  const handleLocalImport = async () => {
    if (!localData?.directoryPath) return;
    setLocalImporting(true);
    setUploadError(null);
    try {
      const result = await importFromDirectory(
        localData.directoryPath,
        "00000000-0000-0000-0000-000000000000",
        ""
      );
      setLocalResult(result);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Import from directory failed. Please try again."
      );
    } finally {
      setLocalImporting(false);
    }
  };

  const handleDeepDiveImport = async () => {
    if (!localData?.directoryPath) return;
    setDeepDiveImporting(true);
    setUploadError(null);
    try {
      const result = await importFullProfile(localData.directoryPath);
      setDeepDiveResult(result);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Deep profile import failed. Please try again."
      );
    } finally {
      setDeepDiveImporting(false);
    }
  };

  // Show deep dive result
  if (deepDiveResult) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-6 w-6 text-green-500" />
          <h3 className="text-lg font-medium">Deep Profile Import Complete</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{deepDiveResult.totalFiles}</p>
            <p className="text-xs text-muted-foreground">Files Processed</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">v{deepDiveResult.version}</p>
            <p className="text-xs text-muted-foreground">Profile Version</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{deepDiveResult.skippedFiles.length}</p>
            <p className="text-xs text-muted-foreground">Skipped</p>
          </div>
        </div>

        {deepDiveResult.selfName && (
          <p className="text-sm">
            Profile established for <span className="font-medium">{deepDiveResult.selfName}</span>
          </p>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Imported data sources:</p>
          <div className="flex flex-wrap gap-1.5">
            {deepDiveResult.importedFiles.map((file) => (
              <Badge key={file} variant="secondary" className="text-xs">
                {file}
              </Badge>
            ))}
          </div>
        </div>

        {!localResult && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Your profile is ready. Now import your contacts to enable ICP
              matching and niche discovery.
            </p>
            <Button
              onClick={handleLocalImport}
              disabled={localImporting}
              className="mt-3"
              size="sm"
            >
              {localImporting ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Importing contacts...
                </>
              ) : (
                <>
                  <FolderOpen className="mr-2 h-3 w-3" />
                  Import Contacts Now
                </>
              )}
            </Button>
          </div>
        )}

        {localResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <h4 className="text-sm font-medium">Contacts Imported</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{localResult.totalNew}</p>
                <p className="text-xs text-muted-foreground">New</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{localResult.totalUpdated}</p>
                <p className="text-xs text-muted-foreground">Updated</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{localResult.totalSkipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{localResult.totalErrors}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={() => router.push("/discover")} variant="default">
            Discover ICPs
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button onClick={() => router.push("/contacts")} variant="outline">
            View Contacts
          </Button>
        </div>
      </div>
    );
  }

  // Show directory import result (contacts-only import)
  if (localResult) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-6 w-6 text-green-500" />
          <h3 className="text-lg font-medium">Import Complete</h3>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{localResult.totalNew}</p>
            <p className="text-xs text-muted-foreground">New</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{localResult.totalUpdated}</p>
            <p className="text-xs text-muted-foreground">Updated</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{localResult.totalSkipped}</p>
            <p className="text-xs text-muted-foreground">Skipped</p>
          </div>
          <div className="rounded-md border p-3 text-center">
            <p className="text-2xl font-bold">{localResult.totalErrors}</p>
            <p className="text-xs text-muted-foreground">Errors</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Processed {localResult.recognizedFiles.length} file
          {localResult.recognizedFiles.length !== 1 ? "s" : ""}:{" "}
          {localResult.recognizedFiles.join(", ")}
        </p>

        <Button onClick={() => router.push("/contacts")}>View Contacts</Button>
      </div>
    );
  }

  // Show file-upload import progress
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

  const totalDeepFiles = (localData?.recognizedFiles?.length ?? 0) + (localData?.deepFiles?.length ?? 0);

  return (
    <div className="space-y-6">
      {/* Full LinkedIn Deep Dive - shown when full dump is detected */}
      {localData?.found && localData.hasFullDump && (
        <div className="rounded-lg border-2 border-violet-200 bg-violet-50 p-5 dark:border-violet-900 dark:bg-violet-950/30">
          <div className="flex items-start gap-3">
            <Scan className="mt-0.5 h-5 w-5 text-violet-600 dark:text-violet-400" />
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-medium text-violet-900 dark:text-violet-100">
                  Full LinkedIn Data Export Detected
                </h3>
                <p className="text-sm text-violet-700 dark:text-violet-300">
                  Found {localData.totalCsvCount} files including your profile,
                  ad targeting, endorsements, recommendations, positions,
                  messages, and more. Import everything for a deep ICP and niche
                  analysis.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {localData.recognizedFiles?.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-200"
                  >
                    <FileText className="h-3 w-3" />
                    {FILE_TYPE_LABELS[file.type] || file.type}
                  </span>
                ))}
                {localData.deepFiles?.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1 rounded-full bg-violet-100/60 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/60 dark:text-violet-300"
                  >
                    <FileText className="h-3 w-3" />
                    {DEEP_FILE_LABELS[file.type] || file.type}
                  </span>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={handleDeepDiveImport}
                  disabled={deepDiveImporting || localImporting}
                  className="bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-700"
                >
                  {deepDiveImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Building profile...
                    </>
                  ) : (
                    <>
                      <Scan className="mr-2 h-4 w-4" />
                      Deep Dive Import ({totalDeepFiles} files)
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleLocalImport}
                  disabled={localImporting || deepDiveImporting}
                  variant="outline"
                  className="border-violet-200 dark:border-violet-800"
                >
                  {localImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Contacts Only ({localData.recognizedFiles?.length} files)
                    </>
                  )}
                </Button>
              </div>

              <p className="text-xs text-violet-600 dark:text-violet-400">
                Deep dive builds a versioned profile from your full export. Each
                re-import creates a new version, preserving history. Agents can
                use this profile to recommend ICP and niche refinements.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Standard local detection (non-full-dump fallback) */}
      {localData?.found && !localData.hasFullDump && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950/30">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400" />
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-medium text-green-900 dark:text-green-100">
                  LinkedIn Export Detected
                </h3>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Found {localData.recognizedFiles?.length} importable file
                  {localData.recognizedFiles?.length !== 1 ? "s" : ""} in{" "}
                  <code className="rounded bg-green-100 px-1 py-0.5 text-xs dark:bg-green-900">
                    {localData.directoryPath}
                  </code>
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {localData.recognizedFiles?.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200"
                  >
                    <FileText className="h-3 w-3" />
                    {FILE_TYPE_LABELS[file.type] || file.type}
                  </span>
                ))}
              </div>

              <Button
                onClick={handleLocalImport}
                disabled={localImporting}
                className="w-full sm:w-auto"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                {localImporting
                  ? "Importing..."
                  : `Import ${localData.recognizedFiles?.length} Files`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Divider when both options are shown */}
      {localData?.found && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or upload manually
            </span>
          </div>
        </div>
      )}

      {/* Manual Upload */}
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

      {files.length > 0 && (
        <Button
          onClick={handleUpload}
          disabled={files.length === 0 || uploading}
        >
          {uploading ? "Uploading..." : "Upload & Import"}
        </Button>
      )}
    </div>
  );
}
