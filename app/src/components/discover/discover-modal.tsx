"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Check, Plus } from "lucide-react";

interface DiscoveredItem {
  suggestedName: string;
  description: string;
  contactCount?: number;
  confidence?: number;
  industry?: string;
  keywords?: string[];
  criteria?: Record<string, unknown>;
  sampleContacts?: Array<{ id: string; name: string; title: string | null }>;
  alreadyExists?: boolean;
}

interface DiscoverModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  discoveries: DiscoveredItem[];
  loading: boolean;
  onAccept: (items: DiscoveredItem[]) => Promise<void>;
}

export function DiscoverModal({
  open,
  onClose,
  title,
  discoveries,
  loading,
  onAccept,
}: DiscoverModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggleItem(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(discoveries.map((d, i) => d.alreadyExists ? -1 : i).filter(i => i >= 0)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleAccept() {
    const items = discoveries.filter((_, i) => selected.has(i));
    if (items.length === 0) return;
    setSaving(true);
    try {
      await onAccept(items);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg mx-4 p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Analyzing your network...</span>
          </div>
        ) : discoveries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground text-center">
              No new discoveries found. Your network may need more contacts, or all segments are already covered.
            </p>
          </div>
        ) : (
          <>
            {/* Select all/none controls */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground">
                {selected.size} of {discoveries.length} selected
              </span>
              <div className="flex-1" />
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAll}>
                Select all
              </Button>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectNone}>
                Clear
              </Button>
            </div>

            {/* Discovery list */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {discoveries.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={d.alreadyExists}
                  className={`w-full text-left rounded-md border p-3 transition-colors ${
                    d.alreadyExists
                      ? "border-border opacity-50 cursor-default"
                      : selected.has(i)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => !d.alreadyExists && toggleItem(i)}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                        d.alreadyExists
                          ? "bg-muted border-muted-foreground/20"
                          : selected.has(i)
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {d.alreadyExists ? (
                        <Check className="h-3 w-3 text-muted-foreground" />
                      ) : selected.has(i) ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{d.suggestedName}</span>
                        {d.contactCount != null && d.contactCount > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {d.contactCount} contacts
                          </Badge>
                        )}
                        {d.confidence != null && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              d.confidence > 0.7
                                ? "border-green-500 text-green-600"
                                : d.confidence > 0.4
                                ? "border-yellow-500 text-yellow-600"
                                : "border-muted-foreground"
                            }`}
                          >
                            {Math.round(d.confidence * 100)}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                      {d.keywords && d.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {d.keywords.slice(0, 5).map((kw) => (
                            <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {d.sampleContacts && d.sampleContacts.length > 0 && (
                        <div className="mt-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            e.g. {d.sampleContacts.slice(0, 3).map((c) => c.name).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAccept}
                disabled={selected.size === 0 || saving}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3 mr-1" />
                )}
                Add {selected.size} {selected.size === 1 ? "item" : "items"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
