import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  // Scenario specs share the single current owner in a dedicated database.
  workers: process.env.E2E_DATABASE_URL ? 1 : undefined,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),
    ...(process.env.E2E_SOFTWARE_WEBGL === '1' ? {
      launchOptions: { args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] },
    } : {}),
  },
});
