"use client";

// Target picker — keyboard-triggered (`T`) modal that searches contacts and
// companies. Selecting a result upserts a research_targets row and writes it
// as the session secondary target.
//
// WS-4 Phase 1 Track B. Skips activation when an input/textarea is focused so
// the shortcut does not clobber normal typing.

import { useCallback, useEffect, useRef, useState } from "react";

interface ContactResult {
  id: string;
  name: string;
  company: string | null;
}

interface CompanyResult {
  id: string;
  name: string;
  industry: string | null;
}

interface PickerResult {
  kind: "contact" | "company";
  id: string;
  label: string;
  sublabel?: string | null;
}

function shouldIgnoreKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function TargetPickerModal() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global `T` shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (e.key.toLowerCase() !== "t") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shouldIgnoreKey(e)) return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Search as you type.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const [contactsRes, companiesRes] = await Promise.all([
          fetch(`/api/contacts/search?q=${encodeURIComponent(q)}&limit=10`),
          fetch(`/api/companies/search?q=${encodeURIComponent(q)}&limit=10`),
        ]);
        const contactsJson = contactsRes.ok
          ? ((await contactsRes.json()) as { data: ContactResult[] })
          : { data: [] };
        const companiesJson = companiesRes.ok
          ? ((await companiesRes.json()) as { data: CompanyResult[] })
          : { data: [] };

        const combined: PickerResult[] = [
          ...contactsJson.data.map<PickerResult>((c) => ({
            kind: "contact",
            id: c.id,
            label: c.name,
            sublabel: c.company,
          })),
          ...companiesJson.data.map<PickerResult>((co) => ({
            kind: "company",
            id: co.id,
            label: co.name,
            sublabel: co.industry,
          })),
        ];
        setResults(combined);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open]);

  const handleSelect = useCallback(async (result: PickerResult) => {
    try {
      // Upsert the target row
      const createRes = await fetch("/api/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: result.kind, id: result.id }),
      });
      if (!createRes.ok) return;
      const createJson = (await createRes.json()) as { data: { id: string } };
      // Set as secondary
      const stateRes = await fetch("/api/targets/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secondaryTargetId: createJson.data.id }),
      });
      if (!stateRes.ok) return;
      setOpen(false);
      setQ("");
      window.dispatchEvent(new CustomEvent("research-target-changed", {
        detail: {
          secondaryTargetId: createJson.data.id,
          secondaryTargetLabel: result.label,
        },
      }));
    } catch {
      // Silent — leave modal open so user can retry.
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Target picker"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl rounded-lg border border-border bg-background shadow-lg">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contacts and companies..."
          className="w-full rounded-t-lg bg-transparent px-4 py-3 outline-none"
        />
        <div className="max-h-80 overflow-auto border-t border-border/60">
          {loading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Searching...
            </div>
          )}
          {!loading && results.length === 0 && q && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No matches.
            </div>
          )}
          {results.map((result) => (
            <button
              key={`${result.kind}:${result.id}`}
              type="button"
              onClick={() => handleSelect(result)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm transition hover:bg-muted/60"
            >
              <span>
                <span className="font-medium">{result.label}</span>
                {result.sublabel ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {result.sublabel}
                  </span>
                ) : null}
              </span>
              <span className="rounded border border-border/60 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                {result.kind}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
