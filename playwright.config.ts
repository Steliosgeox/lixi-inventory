import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 30000, fullyParallel: false, workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1080 }, launchOptions: process.env.LOCAL_CHROMIUM ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {} } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions: process.env.LOCAL_CHROMIUM ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {} } },
    ...(!process.env.LOCAL_CHROMIUM ? [{ name: 'webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' as const } }] : []),
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
})
