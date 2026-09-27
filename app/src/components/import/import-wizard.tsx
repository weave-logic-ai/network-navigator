"use client";

import { Card, CardContent } from "@/components/ui/card";
import { UploadStep } from "./upload-step";

export function ImportWizard() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Choose files to import</h2>
      <Card>
        <CardContent className="p-6">
          <UploadStep />
        </CardContent>
      </Card>
    </div>
  );
}
