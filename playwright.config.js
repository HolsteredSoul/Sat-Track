import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    fullyParallel: false,
    workers: 1,
    timeout: 45000,
    use: {
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        baseURL: 'http://127.0.0.1:4173/Sat-Track/',
        trace: 'retain-on-failure',
        launchOptions: { args: ['--enable-unsafe-swiftshader'] }
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['Pixel 7'] } }
    ],
    webServer: {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173/Sat-Track/',
        reuseExistingServer: false,
        timeout: 120000
    }
});
