"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WeightSlider } from "@/components/admin/weight-slider";
import { Loader2 } from "lucide-react";

interface WeightProfile {
  id: string;
  name: string;
  description: string | null;
  weights: Record<string, number>;
  isDefault: boolean;
}

interface PreviewDelta {
  contactId: string;
  current: { score: number; tier: string };
  preview: { score: number; tier: string };
  change: number;
}

const TIER_THRESHOLDS = [
  { tier: "gold", min: 80, max: 100, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { tier: "silver", min: 60, max: 79, color: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200" },
  { tier: "bronze", min: 40, max: 59, color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { tier: "watch", min: 0, max: 39, color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
];

export function ScoringTab() {
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profileName, setProfileName] = useState("default");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewDelta[]>([]);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    async function loadWeights() {
      try {
        const res = await fetch("/api/scoring/weights");
        if (!res.ok) throw new Error("Failed to load weights");
        const json = await res.json();
        const profiles: WeightProfile[] = json.data || [];
        const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0];
        if (defaultProfile) {
          setWeights(defaultProfile.weights);
          setProfileName(defaultProfile.name);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Service unavailable");
      } finally {
        setLoading(false);
      }
    }
    loadWeights();
  }, []);

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const sumPercent = Math.round(weightSum * 100);
  const sumValid = Math.abs(sumPercent - 100) <= 1;

  const handleWeightChange = useCallback(
    (dimension: string, value: number) => {
      setWeights((prev) => ({ ...prev, [dimension]: value }));
      setSaveResult(null);
      setPreviews([]);
    },
    []
  );

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const encoded = encodeURIComponent(JSON.stringify(weights));
      const res = await fetch(`/api/scoring/preview?weights=${encoded}&limit=10`);
      if (!res.ok) throw new Error("Preview failed");
      const json = await res.json();
      setPreviews(json.data || []);
    } catch {
      setPreviews([]);
    } finally {
      setPreviewing(false);
    }
  }, [weights]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const putRes = await fetch("/api/scoring/weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, weights, isDefault: true }),
      });
      if (!putRes.ok) {
        const err = await putRes.json();
        throw new Error(err.error || "Save failed");
      }

      const runRes = await fetch("/api/scoring/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!runRes.ok) {
        setSaveResult("Weights saved, but batch scoring failed. Try again later.");
      } else {
        const runJson = await runRes.json();
        const count = runJson.data?.scored ?? 0;
        setSaveResult(`Saved and rescored ${count} contact(s).`);
      }
      setPreviews([]);
    } catch (err) {
      setSaveResult(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [weights, profileName]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-muted-foreground">Loading weights...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Weight sliders */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Weight Distribution</CardTitle>
            <Badge
              variant="outline"
              className={
                sumValid
                  ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                  : "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
              }
            >
              Sum: {sumPercent}%
            </Badge>
          </div>
          <CardDescription>
            Adjust dimension weights. They must total 100% (with 1% tolerance).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(weights).map((dim) => (
            <WeightSlider
              key={dim}
              dimension={dim}
              value={weights[dim]}
              onChange={handleWeightChange}
            />
          ))}
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={!sumValid || previewing} onClick={handlePreview}>
          {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Preview Changes
        </Button>
        <Button disabled={!sumValid || saving} onClick={handleSave}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save &amp; Rescore
        </Button>
        {saveResult && (
          <span className="text-sm text-muted-foreground">{saveResult}</span>
        )}
      </div>

      {/* Preview deltas table */}
      {previews.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview Deltas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-left font-medium">Contact</th>
                    <th className="p-3 text-right font-medium">Current</th>
                    <th className="p-3 text-right font-medium">Preview</th>
                    <th className="p-3 text-right font-medium">Change</th>
                    <th className="p-3 text-left font-medium">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.map((p) => (
                    <tr key={p.contactId} className="border-b last:border-0">
                      <td className="p-3 font-mono text-xs text-muted-foreground">
                        {p.contactId.slice(0, 8)}...
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {p.current.score.toFixed(1)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {p.preview.score.toFixed(1)}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${
                          p.change > 0 ? "text-green-600" : p.change < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {p.change > 0 ? "+" : ""}
                        {p.change.toFixed(1)}
                      </td>
                      <td className="p-3">
                        {p.preview.tier !== p.current.tier ? (
                          <span className="text-xs">
                            {p.current.tier} &rarr; {p.preview.tier}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {p.current.tier}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier thresholds */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tier Thresholds</CardTitle>
          <CardDescription>Score ranges for each contact tier (read-only).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIER_THRESHOLDS.map((t) => (
              <div key={t.tier} className="rounded-lg border p-3 text-center">
                <Badge variant="outline" className={t.color}>
                  {t.tier}
                </Badge>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {t.min} &ndash; {t.max}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
