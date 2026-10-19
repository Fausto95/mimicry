import { PNG } from 'pngjs';

/**
 * Motion comparison between two recordings of the same interaction (Mimicry's
 * filmstrip and a simulator screen recording).
 *
 * Pixels can't be compared frame by frame — the two renderers differ in
 * fonts and anti-aliasing, and the recordings start at different moments —
 * so each recording is reduced to a *progress curve*: how far each frame
 * has travelled from the first frame of the motion to the final one,
 * 0 → 1. Curves are independent of how things look, only of how they move,
 * which is what an easing, a spring or a duration changes.
 */
export interface Frame {
  /** milliseconds since the recording started */
  time: number;
  png: Buffer;
}

export interface MotionCurve {
  /** ms since motion started (first frame that differs from the still start) */
  times: number[];
  progress: number[];
  /** ms from motion start until progress stays within 2% of the end */
  settle: number;
}

export interface MotionComparison {
  ours: MotionCurve;
  reference: MotionCurve;
  /** root-mean-square progress difference over the union of both durations */
  rms: number;
  /** largest progress difference */
  maxGap: number;
  /** our settle time minus the reference's (ms); positive = we are slower */
  settleDelta: number;
}

const THUMB_WIDTH = 96;

/** Downscaled grayscale for robust, cheap differences. */
function thumbnail(png: Buffer): { w: number; h: number; data: Float32Array } {
  const img = PNG.sync.read(png);
  const w = THUMB_WIDTH;
  const h = Math.max(1, Math.round((img.height / img.width) * w));
  const data = new Float32Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor(x * sx);
      const y0 = Math.floor(y * sy);
      for (let yy = y0; yy < Math.min(img.height, Math.floor((y + 1) * sy)); yy += 2) {
        for (let xx = x0; xx < Math.min(img.width, Math.floor((x + 1) * sx)); xx += 2) {
          const i = (yy * img.width + xx) * 4;
          sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
          n++;
        }
      }
      data[y * w + x] = n ? sum / n : 0;
    }
  }
  return { w, h, data };
}

function distance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

/**
 * Progress curve of a recording: trims the still lead-in, measures every
 * frame against the motion's first and last frames.
 */
export function progressCurve(frames: Frame[], options: { startThreshold?: number } = {}): MotionCurve {
  if (frames.length < 2) return { times: [0], progress: [1], settle: 0 };
  const thumbs = frames.map((f) => thumbnail(f.png).data);
  const threshold = options.startThreshold ?? 0.4; // mean gray levels
  let start = 0;
  while (start < thumbs.length - 1 && distance(thumbs[start + 1]!, thumbs[0]!) < threshold) start++;
  const first = thumbs[start]!;
  const last = thumbs[thumbs.length - 1]!;
  const total = distance(first, last) || 1;
  const t0 = frames[start]!.time;
  const times: number[] = [];
  const progress: number[] = [];
  for (let i = start; i < frames.length; i++) {
    times.push(frames[i]!.time - t0);
    // 1 - remaining distance to the end, normalized
    progress.push(Math.max(0, Math.min(1.2, 1 - distance(thumbs[i]!, last) / total)));
  }
  let settle = times[times.length - 1]!;
  for (let i = progress.length - 1; i >= 0; i--) {
    if (Math.abs(1 - progress[i]!) > 0.02) {
      settle = times[Math.min(i + 1, times.length - 1)]!;
      break;
    }
    if (i === 0) settle = 0;
  }
  return { times, progress, settle };
}

function sample(curve: MotionCurve, t: number): number {
  const { times, progress } = curve;
  if (t <= times[0]!) return progress[0]!;
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]!) {
      const k = (t - times[i - 1]!) / (times[i]! - times[i - 1]! || 1);
      return progress[i - 1]! + (progress[i]! - progress[i - 1]!) * k;
    }
  }
  return progress[progress.length - 1]!;
}

export function compareMotion(ours: Frame[], reference: Frame[]): MotionComparison {
  const a = progressCurve(ours);
  const b = progressCurve(reference);
  const end = Math.max(a.settle, b.settle, 16) + 100;
  let sq = 0;
  let max = 0;
  let n = 0;
  for (let t = 0; t <= end; t += 1000 / 120) {
    const d = sample(a, t) - sample(b, t);
    sq += d * d;
    max = Math.max(max, Math.abs(d));
    n++;
  }
  return { ours: a, reference: b, rms: Math.sqrt(sq / n), maxGap: max, settleDelta: a.settle - b.settle };
}

/** An SVG chart of both curves for the oracle report. */
export function motionChartSvg(c: MotionComparison, width = 420, height = 200): string {
  const end = Math.max(c.ours.settle, c.reference.settle, 100) * 1.25;
  const x = (t: number) => 36 + (t / end) * (width - 48);
  const y = (p: number) => height - 24 - p * (height - 40);
  const path = (curve: MotionCurve) =>
    curve.times.filter((t) => t <= end).map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(curve.progress[i]!).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => `<text x="${x(end * k * 0.8)}" y="${height - 6}" font-size="10" fill="#6b7280" text-anchor="middle">${Math.round(end * k * 0.8)}ms</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="white" rx="8"/>
<line x1="36" x2="${width - 12}" y1="${y(1)}" y2="${y(1)}" stroke="#e5e7eb"/><line x1="36" x2="${width - 12}" y1="${y(0)}" y2="${y(0)}" stroke="#e5e7eb"/>
<text x="6" y="${y(1) + 4}" font-size="10" fill="#6b7280">1</text><text x="6" y="${y(0) + 4}" font-size="10" fill="#6b7280">0</text>${ticks}
<path d="${path(c.reference)}" fill="none" stroke="#111827" stroke-width="2"/>
<path d="${path(c.ours)}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="5 3"/>
<text x="${width - 150}" y="18" font-size="11" fill="#111827">— simulator</text><text x="${width - 150}" y="32" font-size="11" fill="#2563eb">- - Mimicry</text>
</svg>`;
}
