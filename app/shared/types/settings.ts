// Settings managed by the app, synced to the extension
export interface ExtensionSettings {
  captureEnabled: boolean;
  autoCapturePages: string[];    // Page types to auto-capture
  captureInterval: number;       // Minimum seconds between captures
  maxDailyCaptures: number;
  showOverlay: boolean;
  overlayPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  syncIntervalSeconds: number;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  captureEnabled: true,
  autoCapturePages: [],
  captureInterval: 30,
  maxDailyCaptures: 100,
  showOverlay: true,
  overlayPosition: 'top-right',
  syncIntervalSeconds: 60,
};
