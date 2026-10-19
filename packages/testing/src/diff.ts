import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * Pixel diff between two PNGs — engine output vs a golden, or vs a real
 * simulator capture (the oracle). Returns the mismatch ratio and a diff image.
 */
export interface DiffResult {
  width: number;
  height: number;
  mismatched: number;
  ratio: number;
  diff: Buffer;
  sizeMismatch: boolean;
}

export function diffPng(a: Buffer, b: Buffer, options: { threshold?: number } = {}): DiffResult {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);
  const pad = (img: PNG) => {
    if (img.width === width && img.height === height) return img.data;
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, Math.min(img.width, width), Math.min(img.height, height), 0, 0);
    return out.data;
  };
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(pad(left), pad(right), diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: false,
    alpha: 0.3,
  });
  return {
    width,
    height,
    mismatched,
    ratio: mismatched / (width * height),
    diff: PNG.sync.write(diff),
    sizeMismatch: left.width !== right.width || left.height !== right.height,
  };
}

/** Lay PNGs side by side (filmstrips, oracle reports). */
export function stripPng(images: Buffer[], gap = 8, background = [255, 255, 255, 255]): Buffer {
  const decoded = images.map((b) => PNG.sync.read(b));
  const height = Math.max(...decoded.map((d) => d.height));
  const width = decoded.reduce((s, d) => s + d.width, 0) + gap * (decoded.length - 1);
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) out.data.set(background, i);
  let x = 0;
  for (const d of decoded) {
    PNG.bitblt(d, out, 0, 0, d.width, d.height, x, 0);
    x += d.width + gap;
  }
  return PNG.sync.write(out);
}
