import { defineConfig } from '@playwright/test';
export default defineConfig({
  reporter: [['list'], ['github']],
  testDir: './test', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5173', serviceWorkers: 'block' },
  webServer: { command: 'npm run dev -- --host 0.0.0.0', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  projects: [390, 768, 1280].map(width => ({ name: `${width}px`, use: { viewport: { width, height: 900 } } })),
});
