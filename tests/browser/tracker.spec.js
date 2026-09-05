import { test, expect } from '@playwright/test';
import { iss, sixDigit, tle } from '../fixtures/orbits.js';

async function setup(page, { offline = false, workerFails = false } = {}) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
        ({ workerFails, offline, tle }) => {
            Object.defineProperty(navigator, 'onLine', { get: () => !offline });
            Object.defineProperty(navigator, 'clipboard', {
                value: {
                    writeText: async (text) => {
                        window.__shared = text;
                    }
                }
            });
            if (offline)
                localStorage.setItem(
                    'tle_cache_iss',
                    JSON.stringify({ data: tle, timestamp: Date.UTC(2024, 0, 1) })
                );
            const NativeWorker = window.Worker;
            window.Worker = class extends NativeWorker {
                constructor(url, options) {
                    if (workerFails) throw new Error('Test: worker unavailable');
                    super(url, options);
                    window.__workerURL = String(url);
                    this.addEventListener('message', (e) => {
                        window.__workerResult = e.data;
                    });
                }
            };
        },
        { workerFails, offline, tle }
    );
    // No external service is needed: prevent accidental outbound requests from this test suite.
    await page.route('https://**/*', async (route) => {
        if (route.request().url().includes('worldtimeapi.org'))
            return route.fulfill({ status: 503, body: 'Unavailable' });
        if (route.request().url().includes('celestrak.org'))
            return route.fulfill({ status: 200, json: [sixDigit, iss] });
        if (route.request().resourceType() === 'image')
            return route.fulfill({
                contentType: 'image/png',
                body: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
                    'base64'
                )
            });
        return route.fulfill({ status: 200, body: '' });
    });
    return errors;
}

async function ready(page, query = '?t=2024-01-01T12:00:00Z') {
    await page.goto(query);
    await expect(page.locator('#loader-overlay')).toHaveClass(/hidden/);
    if (await page.locator('#ui-container').evaluate((el) => el.classList.contains('hidden')))
        await page.locator('#ui-toggle').click();
    await expect(page.locator('#satCount')).not.toHaveText('0');
}

test('six-digit selection, stable share links, refresh, controls and observer passes', async ({
    page
}, testInfo) => {
    const errors = await setup(page);
    await ready(page);
    await expect(page.locator('#clock-status')).toContainText('SHARED TIME');
    await expect(page.locator('#data-health')).toHaveText('8 live · 0 saved · 0 simulated layers');
    await page.locator('#search-box').fill('TEST-100001');
    await page.locator('.search-item').first().click();
    await expect(page.locator('#tooltip-id')).toHaveText('NORAD: 100001');
    await page.locator('#btn-share').click();
    const shared = await page.evaluate(() => window.__shared);
    expect(new URL(shared).searchParams.get('norad')).toBe('starlink:100001');
    await page.locator('#btn-follow').click();
    await page.route('https://celestrak.org/**', (route) =>
        route.fulfill({ json: [iss, sixDigit] })
    );
    await page.locator('#btn-refresh').click();
    await expect(page.locator('#status-text')).toHaveText('All layers refreshed');
    await expect(page.locator('#btn-follow')).toHaveClass(/active/);
    await expect(page.locator('#tooltip-id')).toHaveText('NORAD: 100001');
    await page.locator('#btn-manual-toggle').click();
    await page.locator('#input-lat').fill('-31.95');
    await page.locator('#input-lon').fill('115.86');
    await page.locator('#btn-manual-location').click();
    await expect(page.locator('#pass-table-container')).not.toBeEmpty();
    await expect(page.locator('#pass-table-container')).not.toContainText('error');
    await page.locator('#layer-gps').uncheck();
    await expect(page.locator('#satCount')).toHaveText('13');
    await page.locator('#layer-gps').check();
    await expect(page.locator('#satCount')).toHaveText('15');
    await page.locator('#btn-reset-time').click();
    await expect(page.locator('#clock-status')).toContainText('NOW · Device clock');
    await page.locator('#ui-toggle').focus();
    await page.keyboard.press('p');
    await expect(page.locator('#clock-status')).toContainText('PAUSED');
    await page.keyboard.press('p');
    await expect(page.locator('#clock-status')).toContainText('NOW');
    expect(await page.evaluate(() => window.__workerURL)).toContain('/Sat-Track/assets/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    await page.locator('#ui-container').evaluate((el) => {
        el.scrollTop = 0;
    });
    const bounds = await page.locator('#ui-container').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
    await page.screenshot({ path: testInfo.outputPath('telemetry.png') });
    expect(errors).toEqual([]);
});

test('offline uses legacy cache and clearly labels simulated layers', async ({ page }) => {
    await setup(page, { offline: true });
    await ready(page);
    await expect(page.locator('#badge-iss')).toHaveText('SAVED');
    await expect(page.locator('#badge-starlink')).toHaveText('SIM');
    await expect(page.locator('#data-health')).toHaveText('0 live · 1 saved · 7 simulated layers');
    await page.locator('#btn-refresh').click();
    await expect(page.locator('#status-text')).toContainText('previous data retained');
    expect(await page.evaluate(() => localStorage.getItem('tle_cache_iss'))).toBeTruthy();
});

test('worker failure keeps synchronous tracking and old index links working', async ({ page }) => {
    const errors = await setup(page, { workerFails: true });
    await ready(page, '?sat=starlink:0&t=2024-01-01T12:00:00Z');
    await expect(page.locator('#tooltip-id')).toHaveText('NORAD: 100001');
    await expect(page.locator('#satCount')).toHaveText('15');
    expect(errors).toEqual([]);
});

test('HTTP failure retains saved data and reports failure instead of success', async ({ page }) => {
    await setup(page);
    await ready(page, '?norad=starlink:100001&t=2024-01-01T12:00:00Z');
    await expect(page.locator('#tooltip-id')).toHaveText('NORAD: 100001');
    await page.route('https://celestrak.org/**', (route) =>
        route.fulfill({ status: 403, body: 'Rate limited' })
    );
    await page.locator('#btn-refresh').click();
    await expect(page.locator('#status-text')).toContainText('Refresh unavailable');
    await expect(page.locator('#badge-starlink')).toHaveText('SAVED');
    await expect(page.locator('#tooltip-id')).toHaveText('NORAD: 100001');
});
