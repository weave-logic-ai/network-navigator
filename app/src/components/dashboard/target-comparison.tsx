import type { ResearchTarget } from "@/lib/targets/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isSignificantDelta, loadContactMetrics, loadSelfContactMetrics, relativeDelta } from "./target-comparison-data";

function Metric({ label, self, focused, format }: {
  label: string;
  self: number | null;
  focused: number | null;
  format: (value: number) => string;
}) {
  const delta = relativeDelta(self, focused);
  const highlighted = isSignificantDelta(delta);
  return (
    <div className="rounded-md border p-4" data-testid={`comparison-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div><span className="block text-muted-foreground">Self</span><strong>{self === null ? "Unavailable" : format(self)}</strong></div>
        <div><span className="block text-muted-foreground">Focused contact</span><strong>{focused === null ? "Unavailable" : format(focused)}</strong></div>
      </div>
      <p className={highlighted ? "mt-3 font-semibold text-primary" : "mt-3 text-muted-foreground"}>
        {delta === null ? "Relative change unavailable" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs self`}
        {highlighted && <span className="sr-only"> (at least 20% difference)</span>}
      </p>
    </div>
  );
}

export async function TargetComparison({ self, focused }: {
  self: ResearchTarget;
  focused: ResearchTarget;
}) {
  const [selfMetrics, focusedMetrics] = await Promise.all([
    loadSelfContactMetrics(),
    focused.contactId ? loadContactMetrics(focused.contactId) : Promise.resolve({ score: null, degree: null, reason: "Contact data is unavailable" }),
  ]);

  return (
    <Card data-testid="dashboard-target-comparison" data-secondary-target-id={focused.id}>
      <CardHeader>
        <CardTitle className="text-base">{focused.label} compared with {self.label}</CardTitle>
        <p className="text-xs text-muted-foreground">Contact score and distinct graph neighbors use stored contact records. Self metrics use the imported self contact when it is unique. A difference of at least 20% is highlighted.</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <Metric label="Contact score" self={selfMetrics.score} focused={focusedMetrics.score} format={(value) => value.toFixed(1)} />
          <Metric label="Graph neighbors" self={selfMetrics.degree} focused={focusedMetrics.degree} format={(value) => value.toLocaleString()} />
        </div>
        {(selfMetrics.reason || focusedMetrics.reason) && (
          <p className="mt-3 text-xs text-muted-foreground">{[selfMetrics.reason, focusedMetrics.reason].filter(Boolean).join("; ")}.</p>
        )}
      </CardContent>
    </Card>
  );
}
