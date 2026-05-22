import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = process.argv[2] || './screenshots';
await mkdir(OUT, { recursive: true });

const VIEWS = [
  // Pre-password gate — no session seed so the gate UI is what we capture.
  { name: 'gate-desktop-light', url: '/db/', viewport: { width: 1440, height: 900 }, scheme: 'light', seedSession: false },
  { name: 'gate-desktop-dark', url: '/db/', viewport: { width: 1440, height: 900 }, scheme: 'dark', seedSession: false },
  { name: 'gate-mobile-light', url: '/db/', viewport: { width: 390, height: 844 }, scheme: 'light', seedSession: false },
  { name: 'gate-mobile-dark', url: '/db/', viewport: { width: 390, height: 844 }, scheme: 'dark', seedSession: false },
  { name: 'db-desktop-light', url: '/db/', viewport: { width: 1440, height: 900 }, scheme: 'light' },
  { name: 'db-desktop-dark', url: '/db/', viewport: { width: 1440, height: 900 }, scheme: 'dark' },
  { name: 'db-mobile-light', url: '/db/', viewport: { width: 390, height: 844 }, scheme: 'light' },
  { name: 'db-mobile-dark', url: '/db/', viewport: { width: 390, height: 844 }, scheme: 'dark' },
  { name: 'inv-desktop-light', url: '/inv/', viewport: { width: 1440, height: 900 }, scheme: 'light' },
  { name: 'inv-desktop-dark', url: '/inv/', viewport: { width: 1440, height: 900 }, scheme: 'dark' },
];

const browser = await chromium.launch();
try {
  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: view.viewport,
      colorScheme: view.scheme,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Pre-seed the shared session so the gate falls through to the workspace.
    // Skip seeding for gate-* views so we capture the pre-password UI.
    if (view.seedSession !== false) {
      await page.addInitScript(() => {
        sessionStorage.setItem(
          'starshots_gate_private',
          JSON.stringify({ expiresAt: Date.now() + 15 * 60 * 1000 }),
        );
      });
    }

    // Stub out the data API so /db renders predictable empty/loaded state.
    await page.route('**/api/db**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          clients: [
            { id: '1', name: 'Aulia & Rian', title: 'Mr.', contact: '@aulia.r' },
            { id: '2', name: 'Family Hartono', title: 'Family', contact: 'hartono@example.com' },
            { id: '3', name: 'Kayla Wijaya', title: 'Ms.', contact: '+62 812 0000 1111' },
            { id: '4', name: 'Studio Open House', title: 'Family', contact: 'studio@example.com' },
          ],
          invoices: [
            { id: 'inv-1', client_name: 'Kayla Wijaya', total: 2500000, status: 'paid' },
            { id: 'inv-2', client_name: 'Aulia & Rian', total: 3500000, status: 'sent' },
          ],
          subscriptions: [
            { id: 'sub-1', service: 'iCloud 200GB', client_name: 'Family Hartono', total: 540000 },
          ],
          items: [],
        }),
      }),
    );
    await page.route('**/api/admin-check', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    );

    await page.goto(`${BASE}${view.url}`, { waitUntil: 'networkidle' });
    // Allow fonts and the radial-gradient bg to fully paint.
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${view.name}.png`, fullPage: false });
    console.log(`✓ ${view.name}`);
    await context.close();
  }
} finally {
  await browser.close();
}
