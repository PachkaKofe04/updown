import { defineConfig, devices } from '@playwright/test';

// Сквозные проверки в настоящем Chrome против запущенного окружения (`pnpm dev` в корне репозитория).
// Файлы *.e2e.ts, чтобы их не подхватывал Vitest.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
      },
    },
  ],
});
