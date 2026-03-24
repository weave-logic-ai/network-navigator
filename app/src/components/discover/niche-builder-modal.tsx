"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Save, Loader2, Plus } from "lucide-react";

interface IndustryOption {
  id: string;
  name: string;
}

interface NicheRow {
  id: string;
  name: string;
  description: string | null;
  industryId: string | null;
  keywords: string[];
  affordability: number | null;
  fitability: number | null;
  buildability: number | null;
  nicheScore: number | null;
  memberCount: number;
}

interface NicheBuilderModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  niche?: NicheRow;
}

function ScoreButtons({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`h-8 w-8 rounded-md border text-xs font-medium transition-colors ${
              value === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted border-input"
            }`}
            onClick={() => onChange(value === n ? null : n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NicheBuilderModal({ open, onClose, onSave, niche }: NicheBuilderModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industryId, setIndustryId] = useState<string | null>(null);
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [newIndustryName, setNewIndustryName] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [affordability, setAffordability] = useState<number | null>(null);
  const [fitability, setFitability] = useState<number | null>(null);
  const [buildability, setBuildability] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!niche;

  // Load industries on open
  useEffect(() => {
    if (!open) return;
    fetch("/api/industries")
      .then((r) => r.json())
      .then((json) => setIndustries(json.data ?? []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (niche) {
      setName(niche.name);
      setDescription(niche.description ?? "");
      setIndustryId(niche.industryId);
      setKeywords(niche.keywords ?? []);
      setAffordability(niche.affordability);
      setFitability(niche.fitability);
      setBuildability(niche.buildability);
    } else {
      setName("");
      setDescription("");
      setIndustryId(null);
      setKeywords([]);
      setAffordability(null);
      setFitability(null);
      setBuildability(null);
    }
    setKeywordInput("");
    setNewIndustryName("");
  }, [niche, open]);

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords((prev) => [...prev, kw]);
    }
    setKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function handleKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  }

  async function addIndustry() {
    const trimmed = newIndustryName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/industries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const json = await res.json();
        const created = json.data;
        setIndustries((prev) => [...prev, { id: created.id, name: created.name }]);
        setIndustryId(created.id);
        setNewIndustryName("");
      }
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        industryId: industryId || undefined,
        keywords,
        affordability,
        fitability,
        buildability,
      };

      const url = isEdit ? `/api/niches/${niche.id}` : "/api/niches";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSave();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-md mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">
            {isEdit ? "Edit Niche" : "New Niche"}
          </h3>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Name *</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Texas dermatology practices"
              className="h-8 text-sm"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this niche..."
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[60px] resize-y"
            />
          </div>

          {/* Industry selector */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Industry</p>
            <Select
              value={industryId ?? "none"}
              onValueChange={(v) => setIndustryId(v === "none" ? null : v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select industry..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No industry</SelectItem>
                {industries.map((ind) => (
                  <SelectItem key={ind.id} value={ind.id}>
                    {ind.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-1.5">
              <Input
                value={newIndustryName}
                onChange={(e) => setNewIndustryName(e.target.value)}
                placeholder="Add new industry..."
                className="h-7 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addIndustry();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={addIndustry}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Keywords */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Keywords</p>
            <div className="flex gap-1.5">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder="Add keyword..."
                className="h-8 text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={addKeyword}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="text-xs gap-1">
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="hover:text-destructive">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Scoring */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Niche Scoring (1-5)</p>
            <ScoreButtons label="Affordability" value={affordability} onChange={setAffordability} />
            <ScoreButtons label="Fitability" value={fitability} onChange={setFitability} />
            <ScoreButtons label="Buildability" value={buildability} onChange={setBuildability} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            {isEdit ? "Update" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
