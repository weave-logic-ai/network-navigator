"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { UploadStep } from "./upload-step";

const steps = ["Upload Files", "Map Fields", "Configure", "Review"];

export function ImportWizard() {
  const [currentStep] = useState(0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                i === currentStep
                  ? "bg-primary text-primary-foreground"
                  : i < currentStep
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </div>
            <span
              className={`text-sm ${
                i === currentStep
                  ? "font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {step}
            </span>
            {i < steps.length - 1 && (
              <div className="mx-2 h-px w-8 bg-border" />
            )}
          </div>
        ))}
      </div>
      <Card>
        <CardContent className="p-6">
          <UploadStep />
        </CardContent>
      </Card>
    </div>
  );
}
