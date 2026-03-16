// Types for extension token authentication

export interface ExtensionToken {
  token: string;
  extensionId: string;
  createdAt: string;
  lastUsedAt: string | null;
  userAgent: string | null;
  isRevoked: boolean;
}

export interface TokenValidationResult {
  valid: boolean;
  extensionId?: string;
  error?: 'INVALID_TOKEN' | 'REVOKED_TOKEN' | 'INVALID_ORIGIN';
}

export interface TokenGenerationResult {
  token: string;
  extensionId: string;
  displayToken: string; // First 8 chars for UI display
}

export interface ExtensionSettings {
  autoCaptureEnabled: boolean;
  capturePageTypes: string[];
  dailyCaptureWarningThreshold: number;
  overlayPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  overlayEnabled: boolean;
  healthCheckIntervalMs: number;
  captureStabilityDelayMs: number;
  maxQueueSize: number;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  autoCaptureEnabled: false,
  capturePageTypes: ['PROFILE', 'SEARCH_PEOPLE', 'COMPANY'],
  dailyCaptureWarningThreshold: 100,
  overlayPosition: 'bottom-right',
  overlayEnabled: true,
  healthCheckIntervalMs: 30000,
  captureStabilityDelayMs: 2000,
  maxQueueSize: 50,
};
