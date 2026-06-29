import { defineConfig, devices } from '@playwright/test';

// Runs the same e2e suite against the PRODUCTION build served by `vite preview`,
// proving the built static output (root `sw.js`, emitted wasm) works in Safari.
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 90000,
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
