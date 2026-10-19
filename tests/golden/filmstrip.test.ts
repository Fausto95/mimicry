import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, stripPng } from '@mimicry/testing';

const showcase = fileURLToPath(new URL('../../examples/showcase', import.meta.url));

async function springStrip() {
  const app = await launch(showcase, { device: 'iphone-17-pro' });
  const s = app.session;
  s.tap({ testID: 'tab-motion' }).advance(100);
  const frames = s.filmstrip({ duration: 600, every: 100, scale: 1, actions: [{ at: 0, run: (x) => x.tap({ testID: 'spring-card' }, 16) }] });
  const node = s.engine.nodes.get(s.find({ testID: 'motion-scroll' })[0]!.id)!;
  s.dispose();
  return { frames, node };
}

describe('filmstrips on a virtual clock', () => {
  it('samples a spring animation and reproduces it exactly', async () => {
    const a = await springStrip();
    const b = await springStrip();
    expect(a.frames.map((f) => f.time)).toEqual([0, 100, 200, 300, 400, 500, 600]);
    // the spring moves between samples…
    expect(a.frames[1]!.png.equals(a.frames[3]!.png)).toBe(false);
    // …and two runs produce identical pixels, frame for frame
    a.frames.forEach((f, i) => expect(f.png.equals(b.frames[i]!.png)).toBe(true));
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/filmstrip-spring.png', stripPng(a.frames.map((f) => f.png)));
  });

  it('scrolls with momentum and stays deterministic', async () => {
    const run = async () => {
      const app = await launch(showcase, { device: 'pixel-9' });
      const s = app.session;
      s.tap({ testID: 'tab-motion' });
      s.drag({ x: 200, y: 700 }, { dx: 0, dy: -300 }, { duration: 120, steps: 6 });
      const scroll = s.engine.nodes.get(s.find({ testID: 'motion-scroll' })[0]!.id)!;
      const afterRelease = scroll.scroll!.y;
      s.advance(400);
      const momentum = scroll.scroll!.y;
      s.settle();
      const final = scroll.scroll!.y;
      s.dispose();
      return { afterRelease, momentum, final };
    };
    const a = await run();
    expect(a.momentum).toBeGreaterThan(a.afterRelease); // kept moving after the finger lifted
    expect(a.final).toBeGreaterThanOrEqual(a.momentum);
    expect(await run()).toEqual(a);
  });
});
