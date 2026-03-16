"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Save, Loader2 } from "lucide-react";

interface IcpBuilderProps {
  onSave: (profile: {
    name: string;
    description: string;
    criteria: {
      roles: string[];
      industries: string[];
      companySizeRanges: string[];
      locations: string[];
      minConnections: number;
      signals: string[];
    };
  }) => Promise<void>;
  onPreviewCount: (criteria: Record<string, unknown>) => Promise<number>;
}

function TagInput({
  label,
  tags,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      onAdd(input.trim());
      setInput("");
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-1.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2"
          onClick={() => {
            if (input.trim()) {
              onAdd(input.trim());
              setInput("");
            }
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button onClick={() => onRemove(tag)} className="hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

export function IcpBuilder({ onSave, onPreviewCount }: IcpBuilderProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [signals, setSignals] = useState<string[]>([]);
  const [minConnections, setMinConnections] = useState(0);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const addTag = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (tag: string) => {
      setter((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    },
    []
  );

  const removeTag = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>) => (tag: string) => {
      setter((prev) => prev.filter((t) => t !== tag));
    },
    []
  );

  async function handlePreview() {
    setPreviewing(true);
    try {
      const count = await onPreviewCount({
        roles,
        industries,
        companySizeRanges: companySizes,
        locations,
        minConnections,
        signals,
      });
      setPreviewCount(count);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        criteria: {
          roles,
          industries,
          companySizeRanges: companySizes,
          locations,
          minConnections,
          signals,
        },
      });
      // Reset form
      setName("");
      setDescription("");
      setRoles([]);
      setIndustries([]);
      setCompanySizes([]);
      setLocations([]);
      setSignals([]);
      setMinConnections(0);
      setPreviewCount(null);
    } finally {
      setSaving(false);
    }
  }

  const hasAnyCriteria =
    roles.length > 0 ||
    industries.length > 0 ||
    companySizes.length > 0 ||
    locations.length > 0 ||
    signals.length > 0 ||
    minConnections > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Profile Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Name</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., SaaS Decision Makers"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
              className="h-8 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Criteria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TagInput
            label="Role Patterns"
            tags={roles}
            onAdd={addTag(setRoles)}
            onRemove={removeTag(setRoles)}
            placeholder="CEO, VP Sales, etc."
          />

          <TagInput
            label="Industries"
            tags={industries}
            onAdd={addTag(setIndustries)}
            onRemove={removeTag(setIndustries)}
            placeholder="SaaS, FinTech, etc."
          />

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Company Size</p>
            <div className="flex flex-wrap gap-1.5">
              {COMPANY_SIZES.map((size) => (
                <Badge
                  key={size}
                  variant={companySizes.includes(size) ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    setCompanySizes((prev) =>
                      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
                    );
                  }}
                >
                  {size}
                </Badge>
              ))}
            </div>
          </div>

          <TagInput
            label="Locations"
            tags={locations}
            onAdd={addTag(setLocations)}
            onRemove={removeTag(setLocations)}
            placeholder="San Francisco, London, etc."
          />

          <TagInput
            label="Signal Keywords"
            tags={signals}
            onAdd={addTag(setSignals)}
            onRemove={removeTag(setSignals)}
            placeholder="hiring, fundraising, etc."
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Min Connections</p>
              <span className="text-xs text-muted-foreground">{minConnections}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={minConnections}
              onChange={(e) => setMinConnections(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </CardContent>
      </Card>

      {previewCount !== null && (
        <div className="rounded-md border bg-muted/50 p-3 text-center">
          <p className="text-2xl font-bold">{previewCount}</p>
          <p className="text-xs text-muted-foreground">contacts match</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handlePreview}
          disabled={!hasAnyCriteria || previewing}
        >
          {previewing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Preview
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={handleSave}
          disabled={!name.trim() || !hasAnyCriteria || saving}
        >
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
          Save ICP
        </Button>
      </div>
    </div>
  );
}
