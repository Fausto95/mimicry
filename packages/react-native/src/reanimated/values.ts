import { parseColor } from '@mimicry/react-native-fabric';

/**
 * Animatable values. Reanimated animates numbers, colors, numbers with units
 * ('90deg', '50%'), and arrays/objects of those. Every animation in Mimicry
 * works on a flat vector of numbers: a value is split into components once
 * (`vectorize`) and rebuilt from animated components each frame (`build`).
 * Colors animate per RGBA channel, like Reanimated's default color mode.
 */
export interface Vector {
  components: number[];
  build(components: number[]): unknown;
}

const UNIT = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)([a-z%]*)$/i;

export function isColorLike(value: unknown): boolean {
  return typeof value === 'string' && !UNIT.test(value.trim()) && parseColor(value) != null;
}

/** Packed 0xRRGGBBAA → [r, g, b, a] with a in 0..1. */
export function rgbaComponents(color: number): [number, number, number, number] {
  return [(color >>> 24) & 255, (color >>> 16) & 255, (color >>> 8) & 255, (color & 255) / 255];
}

export function rgbaString(r: number, g: number, b: number, a: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000})`;
}

export function vectorize(value: unknown): Vector {
  if (typeof value === 'number') return { components: [value], build: (c) => c[0] };
  if (typeof value === 'boolean') return { components: [value ? 1 : 0], build: (c) => c[0]! >= 0.5 };
  if (typeof value === 'string') {
    const m = UNIT.exec(value.trim());
    if (m) {
      const unit = m[2] ?? '';
      return { components: [parseFloat(m[1]!)], build: (c) => `${c[0]}${unit}` };
    }
    const color = parseColor(value);
    if (color != null) {
      return { components: rgbaComponents(color), build: (c) => rgbaString(c[0]!, c[1]!, c[2]!, c[3]!) };
    }
    return { components: [], build: () => value };
  }
  if (Array.isArray(value)) {
    const parts = value.map(vectorize);
    return composite(parts, (built) => built);
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const parts = keys.map((k) => vectorize((value as Record<string, unknown>)[k]));
    return composite(parts, (built) => Object.fromEntries(keys.map((k, i) => [k, built[i]])));
  }
  return { components: [], build: () => value };
}

function composite(parts: Vector[], assemble: (built: unknown[]) => unknown): Vector {
  const components = parts.flatMap((p) => p.components);
  return {
    components,
    build(c) {
      let offset = 0;
      const built = parts.map((p) => {
        const slice = c.slice(offset, offset + p.components.length);
        offset += p.components.length;
        return p.build(slice);
      });
      return assemble(built);
    },
  };
}

/**
 * Components of `value` in the shape of `target` (for animating from a value
 * that is a color while the target is a color, etc.). Falls back to the
 * target's own components when shapes differ.
 */
export function componentsLike(value: unknown, target: Vector): number[] {
  const v = vectorize(value).components;
  return v.length === target.components.length ? v : target.components.slice();
}
