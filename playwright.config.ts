import { defineConfig } from '@playwright/test'

// End-to-end tests drive the real app (dev server or the Docker stack) with
// real PostgreSQL behind it. Start the databases first: npm run services.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3300'

export default defineConfig({
    testDir: './e2e',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        viewport: { width: 1440, height: 900 },
    },
    // No device preset: its Windows user agent would make Monaco expect Ctrl
    // while Playwright sends Cmd for ControlOrMeta on macOS.
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: process.env.E2E_BASE_URL
        ? undefined
        : {
              command: 'npm run dev',
              url: `${baseURL}/api/health`,
              reuseExistingServer: true,
              timeout: 120_000,
          },
})
