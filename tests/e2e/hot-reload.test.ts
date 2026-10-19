import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '@mimicry/testing';

const showcase = fileURLToPath(new URL('../../examples/showcase', import.meta.url));

describe('hot reload', () => {
  it('swaps an edited component and keeps its state (Fast Refresh)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimicry-hmr-'));
    cpSync(showcase, dir, { recursive: true });
    const app = await launch(dir, { device: 'iphone-17-pro' });
    const s = app.session;
    s.tap({ testID: 'tap-card' }).tap({ testID: 'tap-card' }).tap({ testID: 'tap-card' });
    expect(s.text({ testID: 'tap-count' })).toEqual(['3']);

    const file = join(dir, 'src/screens/HomeScreen.tsx');
    writeFileSync(file, readFileSync(file, 'utf8').replace('>Taps<', '>Taps (edited)<'));
    expect(await app.hotReload(['src/screens/HomeScreen.tsx'])).toBe('refreshed');
    expect(s.exists({ text: 'Taps (edited)' })).toBe(true);
    expect(s.text({ testID: 'tap-count' })).toEqual(['3']);

    // A syntax error surfaces as a RedBox; saving the fix recovers (like React Native).
    const good = readFileSync(file, 'utf8');
    writeFileSync(file, good.replace('export function HomeScreen', 'export function HomeScreen(('));
    await app.hotReload(['src/screens/HomeScreen.tsx']);
    expect(s.exists({ testID: 'redbox' })).toBe(true);
    writeFileSync(file, good);
    await app.hotReload(['src/screens/HomeScreen.tsx']);
    expect(s.exists({ testID: 'redbox' })).toBe(false);
    expect(s.exists({ text: 'Taps (edited)' })).toBe(true);
    s.dispose();
  });
});
