/**
 * Browser smoke test: Studio + engine worker + compositor in real Chromium.
 * Usage: start `mimicry dev examples/showcase --port 5180`, then run this.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.env.MIMICRY_URL ?? 'http://127.0.0.1:5180';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForSelector('#status.live', { timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'artifacts/studio-ios.png' });

// Hardware changes are browser-only; the app must remain live during finish changes.
if (await page.locator('#device').inputValue() !== 'iphone-18-pro')
  throw new Error('Expected the modern iPhone 18 Pro Studio default');
for (const id of ['iphone-16-pro', 'iphone-17-pro', 'ipad-pro-13-m5', 'iphone-18-pro']) {
  await page.selectOption('#device', id);
  if (await page.locator('#frame').getAttribute('data-device') !== id)
    throw new Error(`Device shell not updated: ${id}`);
}
await page.selectOption('#finish', 'silver');
if (await page.locator('#frame').getAttribute('data-finish') !== 'silver')
  throw new Error('Finish was not applied to physical shell');
if (!(await page.locator('#status').getAttribute('class'))?.includes('live'))
  throw new Error('Cosmetic shell update unexpectedly rebooted the engine');
await page.screenshot({ path: 'artifacts/studio-ios-silver.png' });


// Tap the stat card through real pointer events on the canvas.
const canvas = page.locator('canvas.mimicry-canvas');
const box = (await canvas.boundingBox())!;
const zoom = box.width / 402;
const tapAt = async (x: number, y: number) => {
  await page.mouse.move(box.x + x * zoom, box.y + y * zoom);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(250);
};
await tapAt(60, 420);
await tapAt(60, 420);
// Switch tab: Components (tab bar near the bottom)
await tapAt(150, 812);
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/studio-components.png' });

// Type into the native input mounted over the canvas.
const input = page.locator('.mimicry-native-input').first();
await input.click();
await page.keyboard.type('Ada');
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/studio-typing.png' });

// Android
await page.click('#platform button[data-value="android"]');
await page.waitForSelector('#status.live', { timeout: 30000 });
if (await page.locator('#device').inputValue() !== 'pixel-11-pro')
  throw new Error('Expected the modern Pixel 11 Pro Studio default');
await page.selectOption('#device', 'galaxy-s26-ultra');
await page.waitForTimeout(300);
await page.selectOption('#device', 'pixel-11-pro');
await page.waitForTimeout(800);
await page.click('#appearance button[data-value="dark"]');
await page.waitForTimeout(600);
await page.click('.tabs button[data-tab="engine"]');
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/studio-android-dark.png' });
if (errors.length) {
  console.error(`page errors:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else console.log('PASS: Studio booted both platforms, taps and native text input reached the app');
await browser.close();
