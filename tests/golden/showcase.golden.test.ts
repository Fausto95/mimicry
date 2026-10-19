import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { diffPng, launch } from '@mimicry/testing';

/**
 * Golden images: the engine is deterministic (virtual clock, bundled fonts),
 * so a render either matches its golden or something changed on purpose.
 * MIMICRY_UPDATE_GOLDENS=1 rewrites them.
 */
const showcase = fileURLToPath(new URL('../../examples/showcase', import.meta.url));
const dir = fileURLToPath(new URL('./__goldens__', import.meta.url));
const update = process.env.MIMICRY_UPDATE_GOLDENS === '1';

const cases = [
  { name: 'ios-home-light', device: 'iphone-17-pro', appearance: 'light' as const, tab: null },
  { name: 'ios-components-dark', device: 'iphone-17-pro', appearance: 'dark' as const, tab: 'tab-components' },
  { name: 'android-home-light', device: 'pixel-9', appearance: 'light' as const, tab: null },
  { name: 'android-settings-dark', device: 'pixel-9', appearance: 'dark' as const, tab: 'tab-settings' },
  { name: 'ipad-home-light', device: 'ipad-air-11', appearance: 'light' as const, tab: null },
];

describe('golden renders', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const app = await launch(showcase, { device: c.device, appearance: c.appearance });
      const s = app.session;
      if (c.tab) s.tap({ testID: c.tab }).settle();
      await s.ready();
      const png = s.screenshot(1);
      s.dispose();
      const file = join(dir, `${c.name}.png`);
      mkdirSync('artifacts/golden', { recursive: true });
      writeFileSync(`artifacts/golden/${c.name}.png`, png);
      if (update || !existsSync(file)) {
        writeFileSync(file, png);
        return;
      }
      const result = diffPng(png, readFileSync(file), { threshold: 0.1 });
      if (result.ratio > 0.002) writeFileSync(`artifacts/golden/${c.name}.diff.png`, result.diff);
      expect(result.sizeMismatch).toBe(false);
      expect(result.ratio).toBeLessThan(0.002);
    });
  }
});
