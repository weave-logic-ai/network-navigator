"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ImportError {
  file?: string;
  row?: number;
  message?: string;
}

interface Session {
  id: string;
  status: string;
  total_files: number;
  new_records: number;
  updated_records: number;
  skipped_records: number;
  error_count: number;
  errors: ImportError[];
}

export function displayedImportErrorCount(session: Pick<Session, 'error_count' | 'errors'>): number {
  return Math.max(session.error_count, Array.isArray(session.errors) ? session.errors.length : 0);
}

export function ImportHistory() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/import/history", { cache: "no-store" });
      if (!response.ok) throw new Error("Import history could not be loaded.");
      const body = (await response.json()) as { data: Session[] };
      setSessions(body.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import history could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return (
    <section className="mt-8 space-y-3" aria-label="Recent import outcomes">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Recent import outcomes</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Refresh</Button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {!error && sessions.length === 0 && <p className="text-sm text-muted-foreground">No import sessions yet.</p>}
      {sessions.map((session) => (
        <div key={session.id} className="rounded-md border p-4 text-sm">
          <p className="font-medium">{session.status} · {session.total_files} file{session.total_files === 1 ? "" : "s"}</p>
          <p className="text-muted-foreground">
            {session.new_records} new, {session.updated_records} updated, {session.skipped_records} skipped, {displayedImportErrorCount(session)} errors.
          </p>
          {session.status === "completed" && session.new_records === 0 && session.updated_records === 0 && session.skipped_records > 0 && (
            <p className="text-muted-foreground">No new records were added; skipped records may include previously imported contacts.</p>
          )}
          {session.status === "failed" && <p className="text-muted-foreground">This session cannot be resumed. Start a new import after correcting the error.</p>}
          {Array.isArray(session.errors) && session.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
              {session.errors.map((issue, index) => (
                <li key={index}>
                  {[issue.file, issue.row ? `row ${issue.row}` : null, issue.message || "Import error"].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
