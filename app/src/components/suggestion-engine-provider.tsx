"use client";

import { ReactNode } from "react";
import {
  SuggestionEngineContext,
  useSuggestionEngineState,
} from "@/hooks/use-suggestion-engine";

export function SuggestionEngineProvider({ children }: { children: ReactNode }) {
  const state = useSuggestionEngineState();
  return (
    <SuggestionEngineContext.Provider value={state}>
      {children}
    </SuggestionEngineContext.Provider>
  );
}
