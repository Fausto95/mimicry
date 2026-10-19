import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '@mimicry/testing';

const showcase = fileURLToPath(new URL('../../examples/showcase', import.meta.url));
mkdirSync('artifacts', { recursive: true });

describe('showcase app (compiled like the dev server does)', () => {
  it('boots on iOS, resolves .ios.tsx, assets and .env, and navigates', async () => {
    const app = await launch(showcase, { device: 'iphone-17-pro' });
    const s = app.session;
    expect(app.buildErrors).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.exists({ text: 'PlatformBadge.ios.tsx' })).toBe(true);
    writeFileSync('artifacts/showcase-ios-home.png', s.screenshot());
    s.tap({ testID: 'tap-card' }).tap({ testID: 'tap-card' });
    expect(s.text({ testID: 'tap-count' })).toEqual(['2']);
    s.tap({ testID: 'tab-settings' });
    expect(s.exists({ text: 'Hello from .env' })).toBe(true);
    writeFileSync('artifacts/showcase-ios-settings.png', s.screenshot());
    s.dispose();
  });

  it('boots on Android with the .android.tsx variant', async () => {
    const app = await launch(showcase, { device: 'pixel-9' });
    const s = app.session;
    expect(s.errors).toEqual([]);
    expect(s.exists({ text: 'PLATFORMBADGE.ANDROID.TSX' })).toBe(true);
    writeFileSync('artifacts/showcase-android-home.png', s.screenshot());
    s.dispose();
  });
});

describe('regressions', () => {
  it('repaints text when only its color changes', async () => {
    const app = await launch(showcase, { device: 'iphone-17-pro' });
    const s = app.session;
    const before = s.screenshot(1);
    s.tap({ testID: 'tab-settings' });
    const label = s.engine.nodes.get(s.find({ text: 'Settings' }).at(-1)!.id)!;
    const run = s.engine.textLayoutFor(label, label.w).lines[0]!.runs[0]!;
    expect(run.style.color >>> 8).toBe(0x007aff);
    expect(before.equals(s.screenshot(1))).toBe(false);
    s.dispose();
  });
});
