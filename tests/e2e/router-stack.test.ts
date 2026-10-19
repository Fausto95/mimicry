import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { launch } from '@mimicry/testing';

/**
 * expo-router + react-native-screens end to end: the real libraries run
 * (vendored) against Mimicry's native stack. Requires
 * `npm install` in examples/router-stack.
 */
const project = fileURLToPath(new URL('../../examples/router-stack', import.meta.url));
const installed = existsSync(`${project}/node_modules/expo-router/package.json`);
if (!installed) console.warn('router-stack.test: run `npm install` in examples/router-stack to enable these tests.');

describe.skipIf(!installed)('native stack (expo-router + react-native-screens)', () => {
  it('pushes with a transition, shows a back button and pops back', async () => {
    const app = await launch(project, { device: 'iphone-17-pro' });
    const s = app.session;
    expect(app.buildErrors).toEqual([]);
    expect(s.errors).toEqual([]);
    expect(s.exists({ text: 'Inbox' })).toBe(true);

    s.tap({ testID: 'row-1' });
    s.advance(100);
    const mid = s.find({ testID: 'details-title' })[0]!;
    expect(mid.rect.x).toBeGreaterThan(30); // still sliding in from the right
    s.settle();
    const done = s.find({ testID: 'details-title' })[0]!;
    expect(done.rect.x).toBeCloseTo(24, 0);
    expect(s.exists({ testID: 'header-back' })).toBe(true);

    s.tap({ testID: 'header-back' });
    s.settle();
    expect(s.exists({ testID: 'details-title' })).toBe(false);
    expect(s.exists({ testID: 'row-1' })).toBe(true);
    expect(s.errors).toEqual([]);
    s.dispose();
  });

  it('presents a modal and dismisses it from JS', async () => {
    const app = await launch(project, { device: 'iphone-17-pro' });
    const s = app.session;
    s.tap({ testID: 'compose' });
    s.settle();
    expect(s.exists({ text: 'New Message' })).toBe(true);
    s.tap({ testID: 'close' });
    s.settle();
    expect(s.exists({ testID: 'close' })).toBe(false);
    expect(s.errors).toEqual([]);
    s.dispose();
  });
});
