"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "suggestion-engine-enabled";

interface SuggestionEngineState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

export const SuggestionEngineContext = createContext<SuggestionEngineState>({
  enabled: false,
  toggle: () => {},
  setEnabled: () => {},
});

export function useSuggestionEngine() {
  return useContext(SuggestionEngineContext);
}

export function useSuggestionEngineState(): SuggestionEngineState {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Default OFF — only enable if explicitly set to "true"
    if (saved === "true") setEnabledState(true);
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  const toggle = useCallback(() => {
    setEnabledState((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { enabled, toggle, setEnabled };
}
