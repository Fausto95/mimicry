import { rrectPath, type CanvasFactory, type Ctx2D } from './execute';

/**
 * Backdrop material (CompositeOp.Backdrop): blur and saturate what has been
 * composited so far beneath a rounded rect — UIVisualEffectView, expo-blur,
 * Liquid Glass. It runs at composite time on the surface the layer draws
 * into, so it always sees the current backdrop and is never rasterized into
 * a cached chunk.
 */
export type Matrix = [number, number, number, number, number, number];

export interface BackdropParams {
  x: number;
  y: number;
  w: number;
  h: number;
  radii: [number, number, number, number];
  /** blur radius in points */
  blur: number;
  /** 1 = unchanged */
  saturation: number;
}

type Surface = { width: number; height: number; getContext(type: '2d'): Ctx2D | null };

const filterSupport = new WeakMap<object, boolean>();

/** `ctx.filter` exists in Chrome, Firefox, Safari ≥ 18 and @napi-rs/canvas; older Safari ignores it. */
function supportsFilter(ctx: Ctx2D): boolean {
  const proto = Object.getPrototypeOf(ctx) as object;
  let ok = filterSupport.get(proto);
  if (ok === undefined) {
    const c = ctx as unknown as { filter?: string };
    const previous = c.filter;
    try {
      c.filter = 'blur(1px)';
      ok = c.filter === 'blur(1px)';
    } catch {
      ok = false;
    }
    c.filter = previous ?? 'none';
    filterSupport.set(proto, ok);
  }
  return ok;
}

export class BackdropPainter {
  private scratch: { canvas: Surface; ctx: Ctx2D } | null = null;
  private small: { canvas: Surface; ctx: Ctx2D } | null = null;

  constructor(private readonly canvases: CanvasFactory) {}

  private surface(slot: 'scratch' | 'small', w: number, h: number): { canvas: Surface; ctx: Ctx2D } {
    let s = this[slot];
    if (!s || s.canvas.width < w || s.canvas.height < h) {
      const canvas = this.canvases.create(Math.max(w, s?.canvas.width ?? 0), Math.max(h, s?.canvas.height ?? 0));
      s = { canvas, ctx: canvas.getContext('2d')! };
      this[slot] = s;
    }
    return s;
  }

  /**
   * @param m logical → device-pixel matrix of the current layer
   * @param alpha the layer's accumulated opacity (a fading material fades its blur too)
   */
  draw(ctx: Ctx2D, m: Matrix, p: BackdropParams, alpha: number): void {
    const source = (ctx as { canvas?: Surface }).canvas;
    if (!source || p.w <= 0 || p.h <= 0 || alpha <= 0) return;
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    // Device-space bounds of the material, padded so the blur has context.
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [px, py] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h]] as const) {
      xs.push(m[0] * px + m[2] * py + m[4]);
      ys.push(m[1] * px + m[3] * py + m[5]);
    }
    const blurPx = Math.max(0, p.blur * scale);
    const pad = Math.ceil(blurPx * 2);
    const bx = Math.floor(Math.min(...xs)) - pad;
    const by = Math.floor(Math.min(...ys)) - pad;
    const bw = Math.ceil(Math.max(...xs)) + pad - bx;
    const bh = Math.ceil(Math.max(...ys)) + pad - by;
    // The part of that region that exists on the surface.
    const sx = Math.max(0, bx);
    const sy = Math.max(0, by);
    const sw = Math.min(source.width, bx + bw) - sx;
    const sh = Math.min(source.height, by + bh) - sy;
    if (sw <= 0 || sh <= 0) return;

    const { canvas, ctx: s } = this.surface('scratch', bw, bh);
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    (s as unknown as { filter: string }).filter = 'none';
    s.clearRect(0, 0, bw, bh);
    const ox = sx - bx;
    const oy = sy - by;
    s.drawImage(source as unknown as CanvasImageSource, sx, sy, sw, sh, ox, oy, sw, sh);
    // Past the surface edge, extend the edge pixels (as UIKit does) instead of blurring in transparency.
    const img = canvas as unknown as CanvasImageSource;
    if (oy > 0) s.drawImage(img, ox, oy, sw, 1, ox, 0, sw, oy);
    if (oy + sh < bh) s.drawImage(img, ox, oy + sh - 1, sw, 1, ox, oy + sh, sw, bh - oy - sh);
    if (ox > 0) s.drawImage(img, ox, 0, 1, bh, 0, 0, ox, bh);
    if (ox + sw < bw) s.drawImage(img, ox + sw - 1, 0, 1, bh, ox + sw, 0, bw - ox - sw, bh);

    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.beginPath();
    rrectPath(ctx, p.x, p.y, p.w, p.h, p.radii[0], p.radii[1], p.radii[2], p.radii[3]);
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    if (supportsFilter(ctx)) {
      const parts: string[] = [];
      if (blurPx > 0) parts.push(`blur(${blurPx.toFixed(2)}px)`);
      if (p.saturation !== 1) parts.push(`saturate(${p.saturation})`);
      const c = ctx as unknown as { filter: string };
      c.filter = parts.length ? parts.join(' ') : 'none';
      ctx.drawImage(img, 0, 0, bw, bh, bx, by, bw, bh);
      c.filter = 'none';
    } else {
      // No canvas filters: downsample and scale back up with smoothing (a cheap blur, no saturation).
      const factor = Math.max(1, blurPx / 2);
      const tw = Math.max(1, Math.round(bw / factor));
      const th = Math.max(1, Math.round(bh / factor));
      const small = this.surface('small', tw, th);
      small.ctx.setTransform(1, 0, 0, 1, 0, 0);
      small.ctx.clearRect(0, 0, tw, th);
      small.ctx.imageSmoothingEnabled = true;
      small.ctx.drawImage(img, 0, 0, bw, bh, 0, 0, tw, th);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small.canvas as unknown as CanvasImageSource, 0, 0, tw, th, bx, by, bw, bh);
    }
    ctx.restore();
  }
}
