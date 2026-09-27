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
import type { ImportSession } from "@/lib/types/import";
import { detectContactFileType, ownerProfilePreviewReady, previewContactCsv, type MappingPreview } from "@/lib/import/mapping-preview";

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
  receipts: "Receipts",
  registration: "Registration",
  rich_media: "Rich Media",
  saved_job_alerts: "Job Alerts",
  volunteering: "Volunteering",
  projects: "Projects",
  courses: "Courses",
};

export function DirectoryImportCards({ result }: { result: DirectoryImportResult }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {([
        ["New", result.newRecords],
        ["Updated", result.updatedRecords],
        ["Skipped", result.skippedRecords],
        ["Errors", result.errorCount],
      ] as const).map(([label, count]) => (
        <div key={label} className="rounded-md border p-3 text-center">
          <p className="text-2xl font-bold">{count}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

export function DirectoryImportOutcome({ result, contacts = false }: { result: DirectoryImportResult; contacts?: boolean }) {
  const failed = result.status === 'failed';
  const imported = result.newRecords + result.updatedRecords;
  return <div className="space-y-4" aria-label="Directory import outcome">
    <div className="flex items-center gap-3">
      {failed ? <AlertCircle className="h-5 w-5 text-destructive" /> : <CheckCircle className="h-5 w-5 text-green-500" />}
      <h4 className="text-sm font-medium">{failed ? (contacts ? 'Contacts Import Failed' : 'Import Failed') : (contacts ? 'Contacts Imported' : 'Import Complete')}</h4>
    </div>
    <DirectoryImportCards result={result} />
    {failed && <p className="text-sm text-destructive">{imported} record{imported === 1 ? '' : 's'} imported before failure; {result.skippedRecords} skipped.</p>}
    {result.errors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive" aria-label="Directory import errors">
      {result.errors.map((error, index) => <li key={index}>
        {error.file || 'Import'}{error.row ? ` row ${error.row}` : ''}: {error.message}
      </li>)}
    </ul>}
  </div>;
}

export function MappingPreviewList({ previews }: { previews: MappingPreview[] }) {
  return <div className="space-y-3" aria-label="Field mapping preview">
    <h4 className="text-sm font-medium">Field mapping preview</h4>
    {previews.map(preview => <div key={preview.file} className="rounded-md border bg-background p-3 text-sm">
      <p className="font-medium">{preview.file} → {preview.target}</p>
      {preview.fields.length > 0 && <ul className="mt-2 space-y-1">
        {preview.fields.map(field => <li key={field.source}>
          <span className="font-medium">{field.source}</span> → {field.destination}
          {field.example && <span className="block truncate text-xs text-muted-foreground">Example: {field.example}</span>}
        </li>)}
      </ul>}
      {preview.ignored.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Ignored columns: {preview.ignored.join(', ')}</p>}
      {preview.warning && <p className="mt-2 text-xs text-destructive">{preview.warningDisposition === 'skip' ? 'This file will be skipped: ' : ''}{preview.warning}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Previewed {preview.rowsSampled} sample row{preview.rowsSampled === 1 ? "" : "s"}</p>
    </div>)}
  </div>;
}

export function SessionImportErrors({ session }: { session: ImportSession }) {
  const errors = session.errors ?? [];
  const total = Math.max(session.errorTotal ?? 0, session.erroredRecords ?? 0, errors.length);
  if (errors.length === 0 && !session.error && total === 0) return null;
  return <div className="space-y-2 text-sm text-destructive" aria-label="Import errors">
    <p className="font-medium">{total || errors.length} import error{(total || errors.length) === 1 ? "" : "s"}</p>
    {errors.length > 0 ? <ul className="list-disc space-y-1 pl-5">
      {errors.map((error, index) => <li key={index}>
        {error.file ? `${error.file}${error.row ? ` row ${error.row}` : ""}: ` : error.row ? `Row ${error.row}: ` : ""}{error.message}
      </li>)}
    </ul> : session.error ? <p>{session.error}</p> : null}
    {total > errors.length && <p>{errors.length > 0
      ? `Showing ${errors.length} of ${total} errors. Check the source CSV files for remaining rows.`
      : 'Detailed errors are unavailable for this session. Check the source CSV files and try again.'}</p>}
  </div>;
}

export function UploadStep() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [manualPreviews, setManualPreviews] = useState<MappingPreview[]>([]);
  const [previewing, setPreviewing] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    if (files.length === 0) { setManualPreviews([]); setPreviewing(false); return; }
    setPreviewing(true);
    Promise.all(files.map(async file => previewContactCsv(file.name, await file.slice(0, 65536).text())))
      .then(results => { if (!cancelled) setManualPreviews(results.filter((result): result is MappingPreview => result !== null)); })
      .catch(() => { if (!cancelled) setUploadError('Could not preview selected CSV files.'); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [files]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const csvFiles = Array.from(newFiles).filter(f => detectContactFileType(f.name));
    if (csvFiles.length === 0) {
      setUploadError("No supported LinkedIn contacts CSV files selected. Profile Summary.csv is not supported.");
      return;
    }
    setUploadError(csvFiles.length < newFiles.length
      ? 'Unsupported CSV files were excluded. Only supported LinkedIn contacts files will be imported.' : null);
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
    setDeepDiveResult(null);
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
          <h3 className="text-lg font-medium">{deepDiveResult.skippedFiles.length ? 'Owner Profile Imported with Skipped Files' : 'Deep Profile Import Complete'}</h3>
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
        {deepDiveResult.skippedFiles.length > 0 && (
          <p className="text-sm text-muted-foreground">Skipped files: {deepDiveResult.skippedFiles.join(", ")}</p>
        )}
        {deepDiveResult.diagnostics?.map((message) => (
          <p key={message} className="text-sm text-amber-700 dark:text-amber-300">{message}</p>
        ))}
        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

        {!localResult && localData?.recognizedFiles?.some((file) => file.type !== "profile") && (
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
          <DirectoryImportOutcome result={localResult} contacts />
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
        <DirectoryImportOutcome result={localResult} />

        <p className="text-sm text-muted-foreground">
          Accepted {localResult.recognizedFiles.length} file
          {localResult.recognizedFiles.length !== 1 ? "s" : ""}:{" "}
          {localResult.recognizedFiles.join(", ")}
        </p>
        {localResult.skippedFiles?.length ? (
          <p className="text-sm text-muted-foreground">Unrecognized files: {localResult.skippedFiles.join(", ")}</p>
        ) : null}
        {localResult.recognizedFiles.some((name) => name.toLowerCase() === 'profile.csv') && (
          <p className="text-sm text-muted-foreground">Profile.csv was accepted but skipped in the contacts import. Use the separate owner profile import for it.</p>
        )}

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

        {session.files?.some((file) => file.fileName.toLowerCase() === 'profile.csv') && (
          <p className="text-sm text-muted-foreground">Profile.csv was accepted but skipped in the contacts import. It did not update your owner profile.</p>
        )}

        <SessionImportErrors session={session} />

        {isCompleted && (
          <Button onClick={() => router.push("/contacts")}>
            View Contacts
          </Button>
        )}
      </div>
    );
  }

  const totalDeepFiles = localData?.ownerProfileFiles?.length ?? 0;
  const ownerPreviewReady = ownerProfilePreviewReady(localData?.ownerPreviews ?? [], totalDeepFiles);
  const contactPreviewReady = Boolean(localData?.contactPreviews && localData.contactPreviews.length === localData.recognizedFiles?.length &&
    localData.contactPreviews.every(preview => preview.fields.length > 0 || preview.target === 'Owner profile (separate import)'));

  return (
    <div className="space-y-6">
      {/* Full LinkedIn Deep Dive - shown when full dump is detected */}
      {localData?.found && localData.hasOwnerProfileFiles && (
        <div className="rounded-lg border-2 border-violet-200 bg-violet-50 p-5 dark:border-violet-900 dark:bg-violet-950/30">
          <div className="flex items-start gap-3">
            <Scan className="mt-0.5 h-5 w-5 text-violet-600 dark:text-violet-400" />
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-medium text-violet-900 dark:text-violet-100">
                  Owner Profile Files Detected
                </h3>
                <p className="text-sm text-violet-700 dark:text-violet-300">
                  Found {totalDeepFiles} supported owner profile file{totalDeepFiles === 1 ? "" : "s"}
                  {" "}among {localData.totalCsvCount} CSV files. Available files are listed below.
                  Review the field mapping preview before importing.
                </p>
              </div>

              <MappingPreviewList previews={localData.ownerPreviews ?? []} />
              {localData.recognizedFiles?.some(file => file.type !== 'profile') &&
                <MappingPreviewList previews={(localData.contactPreviews ?? []).filter(preview => preview.target !== 'Owner profile (separate import)')} />}

              <div className="flex flex-wrap gap-1.5">
                {localData.recognizedFiles?.filter((file) => localData.ownerProfileFiles?.includes(file.name)).map((file) => (
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
                  disabled={deepDiveImporting || localImporting || !ownerPreviewReady}
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
                      Import Owner Profile ({totalDeepFiles} recognized files)
                    </>
                  )}
                </Button>
                {localData.recognizedFiles?.some((file) => file.type !== "profile") && <Button
                  onClick={handleLocalImport}
                  disabled={localImporting || deepDiveImporting || !contactPreviewReady}
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
                      Import Contacts ({localData.recognizedFiles?.filter((file) => file.type !== "profile").length} contact files)
                    </>
                  )}
                </Button>}
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
      {localData?.found && !localData.hasOwnerProfileFiles && (localData.recognizedFiles?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950/30">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400" />
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-medium text-green-900 dark:text-green-100">
                  LinkedIn Export Detected
                </h3>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Found {localData.recognizedFiles?.length} recognized file
                  {localData.recognizedFiles?.length !== 1 ? "s" : ""} in{" "}
                  <code className="rounded bg-green-100 px-1 py-0.5 text-xs dark:bg-green-900">
                    {localData.directoryPath}
                  </code>
                </p>
              </div>

              <MappingPreviewList previews={localData.contactPreviews ?? []} />

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
                disabled={localImporting || !contactPreviewReady}
                className="w-full sm:w-auto"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                {localImporting
                  ? "Importing..."
                  : `Import ${localData.recognizedFiles?.length} Accepted Files`}
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
          Accepts LinkedIn CSV exports for connections, messages, invitations, endorsements,
          recommendations, positions, education, skills, and company follows. Profile.csv is accepted but skipped here.
          Review the field mapping preview below. Results show processed records and any import errors.
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

      {files.length > 0 && (previewing ? <p className="text-sm">Reading mapping preview...</p>
        : <MappingPreviewList previews={manualPreviews} />)}

      {uploadError && (
        <p className="text-sm text-destructive">{uploadError}</p>
      )}

      {files.length > 0 && (
        <Button
          onClick={handleUpload}
          disabled={files.length === 0 || uploading || previewing || manualPreviews.length !== files.length || manualPreviews.some(preview => preview.warning?.startsWith('No supported columns'))}
        >
          {uploading ? "Uploading..." : "Upload & Import"}
        </Button>
      )}
    </div>
  );
}
