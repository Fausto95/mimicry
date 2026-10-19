import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { launch, type Session } from '@mimicry/testing';

/**
 * react-native-svg end to end: the fixture installs the real library, the
 * compiler vendors it like any app dependency, and its native components
 * resolve to Mimicry's SVG nodes. See tests/fixtures/svg-app/README.md.
 */
const fixture = fileURLToPath(new URL('../fixtures/svg-app', import.meta.url));
const installed = existsSync(`${fixture}/node_modules/react-native-svg/package.json`);
if (!installed) {
  console.warn('svg.test: tests/fixtures/svg-app/node_modules is missing; run the install command in its README to enable these tests.');
}

type RGBA = [number, number, number, number];

function pixels(s: Session) {
  const png = PNG.sync.read(s.screenshot(1));
  return (x: number, y: number): RGBA => {
    const i = (Math.round(y) * png.width + Math.round(x)) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
  };
}

const near = (actual: RGBA, expected: [number, number, number], tolerance = 40) =>
  Math.abs(actual[0] - expected[0]) <= tolerance && Math.abs(actual[1] - expected[1]) <= tolerance && Math.abs(actual[2] - expected[2]) <= tolerance;

const WHITE: [number, number, number] = [255, 255, 255];

describe.skipIf(!installed)('react-native-svg (real library JavaScript)', () => {
  it('draws paths, gradients, dashes, clip paths, groups, symbols and text', async () => {
    const app = await launch(fixture, { device: 'iphone-17-pro' });
    const s = app.session;
    expect(app.buildErrors).toEqual([]);
    expect(s.errors).toEqual([]);
    const at = pixels(s);

    // viewBox 0 0 10 10 → 100×100: the triangle covers the top-right half only
    expect(near(at(80, 120), [255, 0, 0])).toBe(true);
    expect(near(at(20, 180), WHITE)).toBe(true);

    // objectBoundingBox linear gradient: blue on the left, lime on the right
    const left = at(103, 150);
    const right = at(197, 150);
    expect(left[2]).toBeGreaterThan(200);
    expect(left[1]).toBeLessThan(60);
    expect(right[1]).toBeGreaterThan(200);
    expect(right[2]).toBeLessThan(60);

    // strokeDasharray 20 20: ink, gap, ink
    expect(near(at(210, 150), [0, 0, 0])).toBe(true);
    expect(near(at(230, 150), WHITE)).toBe(true);
    expect(near(at(250, 150), [0, 0, 0])).toBe(true);

    // clipPath: purple inside the circle, nothing at the square's corner
    expect(near(at(350, 150), [128, 0, 128])).toBe(true);
    expect(near(at(305, 105), WHITE)).toBe(true);

    // fill inherited from <G>; 50% resolves against the viewport
    expect(near(at(25, 225), [255, 165, 0])).toBe(true);
    // <Use> of a <Symbol> with its viewBox mapped into 50×50, fill from the <Use>
    expect(near(at(75, 225), [0, 128, 128])).toBe(true);
    expect(near(at(52, 202), WHITE)).toBe(true);
    // radial gradient: white center, dark edge
    expect(at(50, 275)[0]).toBeGreaterThan(200);
    expect(at(2, 298)[0]).toBeLessThan(60);

    // bold "A" centered on x=50 (textAnchor middle)
    expect(near(at(350, 250), WHITE)).toBe(false);
    expect(near(at(310, 250), WHITE)).toBe(true);
    s.dispose();
  });

  it('routes touches to shapes by their geometry and animates props', async () => {
    const app = await launch(fixture, { device: 'iphone-17-pro' });
    const s = app.session;
    // the circle's bounding-box corner is outside the circle: no press
    s.pointer('down', 105, 205).advance(40).pointer('up', 105, 205).settle();
    expect(s.text({ testID: 'taps' })).toEqual(['0']);
    s.pointer('down', 150, 250).advance(40).pointer('up', 150, 250).settle();
    expect(s.text({ testID: 'taps' })).toEqual(['1']);
    // measure() on a shape reports its painted bounds
    expect(s.find({ testID: 'press-target' })[0]!.rect).toMatchObject({ x: 110, y: 210, w: 80, h: 80 });

    expect(near(pixels(s)(250, 220), WHITE)).toBe(true);
    s.tap({ testID: 'grow' });
    s.advance(400).settle();
    expect(near(pixels(s)(250, 220), [0, 128, 0])).toBe(true);
    s.dispose();
  });
});
