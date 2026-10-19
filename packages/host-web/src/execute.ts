import { CommandCursor, Op, toCss } from '@mimicry/protocol';

/**
 * Executes draw commands against any Canvas2D-compatible context: a browser
 * canvas, an OffscreenCanvas, or @napi-rs/canvas under Node. This is the only
 * code that knows how a command turns into pixels.
 */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ImageSourceProvider {
  get(uri: string): CanvasImageSource | null;
}

export interface CanvasFactory {
  create(width: number, height: number): { getContext(type: '2d'): Ctx2D | null; width: number; height: number };
}

export interface ExecuteOptions {
  /** device pixels per logical unit of the target (for shadow parameters) */
  pixelRatio: number;
  images: ImageSourceProvider;
  canvases: CanvasFactory;
}

const CAPS: CanvasLineCap[] = ['butt', 'round', 'square'];
const JOINS: CanvasLineJoin[] = ['miter', 'round', 'bevel'];

export function rrectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): void {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  const max = Math.min(w, h) / 2;
  tl = Math.min(tl, max);
  tr = Math.min(tr, max);
  br = Math.min(br, max);
  bl = Math.min(bl, max);
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

const OFFSCREEN_SHIFT = 32768;

export function execute(ctx: Ctx2D, bytes: Uint8Array, start: number, end: number, options: ExecuteOptions): void {
  const c = new CommandCursor(bytes, start, end);
  const pr = options.pixelRatio;
  const hasLetterSpacing = 'letterSpacing' in ctx;
  let letterSpacing = 0;
  while (c.next()) {
    switch (c.op) {
      case Op.Save:
        ctx.save();
        break;
      case Op.Restore:
        ctx.restore();
        break;
      case Op.Transform:
        ctx.transform(c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5));
        break;
      case Op.Alpha:
        ctx.globalAlpha *= c.f32(0);
        break;
      case Op.ClipRect:
        ctx.beginPath();
        ctx.rect(c.f32(0), c.f32(1), c.f32(2), c.f32(3));
        ctx.clip();
        break;
      case Op.ClipRRect:
        ctx.beginPath();
        rrectPath(ctx, c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5), c.f32(6), c.f32(7));
        ctx.clip();
        break;
      case Op.FillRect:
        ctx.fillStyle = toCss(c.u32(4));
        ctx.fillRect(c.f32(0), c.f32(1), c.f32(2), c.f32(3));
        break;
      case Op.FillRRect:
        ctx.fillStyle = toCss(c.u32(8));
        ctx.beginPath();
        rrectPath(ctx, c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5), c.f32(6), c.f32(7));
        ctx.fill();
        break;
      case Op.StrokeRRect: {
        const width = c.f32(8);
        const dash = c.u32(10);
        ctx.strokeStyle = toCss(c.u32(9));
        ctx.lineWidth = width;
        if (dash === 1) ctx.setLineDash([width * 3, width * 3]);
        else if (dash === 2) {
          ctx.setLineDash([0, width * 2]);
          ctx.lineCap = 'round';
        }
        ctx.beginPath();
        rrectPath(ctx, c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5), c.f32(6), c.f32(7));
        ctx.stroke();
        if (dash) {
          ctx.setLineDash([]);
          ctx.lineCap = 'butt';
        }
        break;
      }
      case Op.FillRing:
        ctx.fillStyle = toCss(c.u32(16));
        ctx.beginPath();
        rrectPath(ctx, c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5), c.f32(6), c.f32(7));
        rrectPath(ctx, c.f32(8), c.f32(9), c.f32(10), c.f32(11), c.f32(12), c.f32(13), c.f32(14), c.f32(15));
        ctx.fill('evenodd');
        break;
      case Op.Shadow:
        // Canvas shadow parameters live in device space, unaffected by the transform.
        ctx.shadowColor = toCss(c.u32(0));
        ctx.shadowBlur = c.f32(1) * pr;
        ctx.shadowOffsetX = c.f32(2) * pr;
        ctx.shadowOffsetY = c.f32(3) * pr;
        break;
      case Op.ShadowClear:
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        break;
      case Op.BoxShadow:
        boxShadow(ctx, c, pr);
        break;
      case Op.LinearGradientRRect: {
        const g = ctx.createLinearGradient(c.f32(8), c.f32(9), c.f32(10), c.f32(11));
        const count = c.u32(12);
        for (let i = 0; i < count; i++) g.addColorStop(Math.max(0, Math.min(1, c.f32(13 + i * 2))), toCss(c.u32(14 + i * 2)));
        ctx.fillStyle = g;
        ctx.beginPath();
        rrectPath(ctx, c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5), c.f32(6), c.f32(7));
        ctx.fill();
        break;
      }
      case Op.PathBegin:
        ctx.beginPath();
        break;
      case Op.MoveTo:
        ctx.moveTo(c.f32(0), c.f32(1));
        break;
      case Op.LineTo:
        ctx.lineTo(c.f32(0), c.f32(1));
        break;
      case Op.QuadTo:
        ctx.quadraticCurveTo(c.f32(0), c.f32(1), c.f32(2), c.f32(3));
        break;
      case Op.CubicTo:
        ctx.bezierCurveTo(c.f32(0), c.f32(1), c.f32(2), c.f32(3), c.f32(4), c.f32(5));
        break;
      case Op.Arc:
        ctx.arc(c.f32(0), c.f32(1), Math.max(0, c.f32(2)), c.f32(3), c.f32(4), c.u32(5) === 1);
        break;
      case Op.ClosePath:
        ctx.closePath();
        break;
      case Op.FillPath:
        ctx.fillStyle = toCss(c.u32(0));
        ctx.fill(c.u32(1) === 1 ? 'evenodd' : 'nonzero');
        break;
      case Op.StrokePath:
        ctx.strokeStyle = toCss(c.u32(0));
        ctx.lineWidth = c.f32(1);
        ctx.lineCap = CAPS[c.u32(2)] ?? 'butt';
        ctx.lineJoin = JOINS[c.u32(3)] ?? 'miter';
        ctx.stroke();
        break;
      case Op.ClipPath:
        ctx.clip(c.u32(0) === 1 ? 'evenodd' : 'nonzero');
        break;
      case Op.StrokeStyle: {
        ctx.miterLimit = c.f32(0) || 4;
        ctx.lineDashOffset = c.f32(1);
        const count = c.u32(2);
        const dashes: number[] = [];
        for (let i = 0; i < count; i++) dashes.push(Math.max(0, c.f32(3 + i)));
        ctx.setLineDash(dashes.some((d) => d > 0) ? dashes : []);
        break;
      }
      case Op.FillPathGradient: {
        const rule = c.u32(0) === 1 ? 'evenodd' : 'nonzero';
        const m = gradientMatrix(c, 1);
        if (!m) break;
        // Clip to the path, then flood the clip with the gradient in its own space.
        ctx.save();
        ctx.clip(rule);
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.fillStyle = createGradient(ctx, c, 1);
        const cover = coverRect(m);
        ctx.fillRect(cover.x, cover.y, cover.w, cover.h);
        ctx.restore();
        break;
      }
      case Op.StrokePathGradient: {
        const m = gradientMatrix(c, 3);
        if (!m) break;
        // The path is already in device space; stroke with the gradient's space as the
        // current transform, compensating line width and dashes for its scale.
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
        ctx.save();
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.lineWidth = c.f32(0) / scale;
        ctx.lineCap = CAPS[c.u32(1)] ?? 'butt';
        ctx.lineJoin = JOINS[c.u32(2)] ?? 'miter';
        const dash = ctx.getLineDash();
        if (dash.length) {
          ctx.setLineDash(dash.map((d) => d / scale));
          ctx.lineDashOffset /= scale;
        }
        ctx.strokeStyle = createGradient(ctx, c, 3);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case Op.Font:
        ctx.font = c.string(0);
        break;
      case Op.Text: {
        const spacing = c.f32(3);
        if (hasLetterSpacing && spacing !== letterSpacing) {
          (ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`;
          letterSpacing = spacing;
        }
        ctx.fillStyle = toCss(c.u32(2));
        ctx.fillText(c.string(4), c.f32(0), c.f32(1));
        break;
      }
      case Op.Image:
        drawImage(ctx, c, options);
        break;
      default:
        // Unknown command: the header carries its length, so it is skipped.
        break;
    }
  }
  if (hasLetterSpacing && letterSpacing !== 0) (ctx as CanvasRenderingContext2D).letterSpacing = '0px';
}

/** Gradient fields start at word `at`: kind x0 y0 r0 x1 y1 r1 a b c d e f count (offset color)*. */
function createGradient(ctx: Ctx2D, c: CommandCursor, at: number): CanvasGradient {
  const radial = c.u32(at) === 1;
  const x0 = c.f32(at + 1);
  const y0 = c.f32(at + 2);
  const r0 = c.f32(at + 3);
  const x1 = c.f32(at + 4);
  const y1 = c.f32(at + 5);
  const r1 = c.f32(at + 6);
  const g = radial ? ctx.createRadialGradient(x0, y0, Math.max(0, r0), x1, y1, Math.max(0, r1)) : ctx.createLinearGradient(x0, y0, x1, y1);
  const count = c.u32(at + 13);
  for (let i = 0; i < count; i++) g.addColorStop(Math.max(0, Math.min(1, c.f32(at + 14 + i * 2))), toCss(c.u32(at + 15 + i * 2)));
  return g;
}

/** The gradient's matrix (fields at+7 … at+12), or null when it is degenerate. */
function gradientMatrix(c: CommandCursor, at: number): [number, number, number, number, number, number] | null {
  const m: [number, number, number, number, number, number] = [c.f32(at + 7), c.f32(at + 8), c.f32(at + 9), c.f32(at + 10), c.f32(at + 11), c.f32(at + 12)];
  return Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-12 ? null : m;
}

/** A rectangle in the space of `m` that covers any clip (the preimage of a huge square). */
function coverRect(m: readonly [number, number, number, number, number, number]): { x: number; y: number; w: number; h: number } {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const R = 1e5;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[-R, -R], [R, -R], [R, R], [-R, R]] as const) {
    xs.push((d * (x - e) - c * (y - f)) / det);
    ys.push((-b * (x - e) + a * (y - f)) / det);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function boxShadow(ctx: Ctx2D, c: CommandCursor, pr: number): void {
  const x = c.f32(0);
  const y = c.f32(1);
  const w = c.f32(2);
  const h = c.f32(3);
  const r = [c.f32(4), c.f32(5), c.f32(6), c.f32(7)] as const;
  const color = toCss(c.u32(8));
  const blur = c.f32(9);
  const dx = c.f32(10);
  const dy = c.f32(11);
  const spread = c.f32(12);
  const inset = c.u32(13) === 1;
  // Draw the shape far outside the visible area and let only its shadow land
  // back on screen. Offsets are in device pixels; the shift is in user space.
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const scaleX = (m ? Math.hypot(m.a, m.b) : 0) || pr;
  const shift = OFFSCREEN_SHIFT / scaleX;
  ctx.save();
  ctx.beginPath();
  if (inset) {
    rrectPath(ctx, x, y, w, h, ...r);
    ctx.clip();
  } else {
    // Outset shadows are not painted under the box.
    ctx.rect(x - 1e5, y - 1e5, w + 2e5, h + 2e5);
    rrectPath(ctx, x, y, w, h, ...r);
    ctx.clip('evenodd');
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * scaleX;
  ctx.shadowOffsetX = dx * scaleX + OFFSCREEN_SHIFT;
  ctx.shadowOffsetY = dy * scaleX;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  if (inset) {
    // a ring around the inner (spread-shrunk) shape casts the inset shadow
    ctx.rect(x - shift - 4096, y - 4096, w + 8192, h + 8192);
    const s = spread;
    rrectPath(ctx, x - shift + s, y + s, w - s * 2, h - s * 2, ...r.map((v) => Math.max(0, v - s)) as [number, number, number, number]);
    ctx.fill('evenodd');
  } else {
    const s = spread;
    rrectPath(ctx, x - shift - s, y - s, w + s * 2, h + s * 2, ...r.map((v) => (v > 0 ? Math.max(0, v + s) : 0)) as [number, number, number, number]);
    ctx.fill();
  }
  ctx.restore();
}

const tintCache = new WeakMap<object, Map<string, CanvasImageSource>>();

function drawImage(ctx: Ctx2D, c: CommandCursor, options: ExecuteOptions): void {
  const uri = c.string(9);
  const image = options.images.get(uri);
  if (!image) return;
  const tint = c.u32(8);
  let source: CanvasImageSource = image;
  if (tint !== 0) {
    // tintColor keeps the image's alpha and replaces its color
    const key = String(tint);
    let byTint = tintCache.get(image as object);
    if (!byTint) {
      byTint = new Map();
      tintCache.set(image as object, byTint);
    }
    let tinted = byTint.get(key);
    if (!tinted) {
      const w = (image as { width: number }).width;
      const h = (image as { height: number }).height;
      const canvas = options.canvases.create(w, h);
      const tctx = canvas.getContext('2d')!;
      tctx.drawImage(image, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = toCss(tint);
      tctx.fillRect(0, 0, w, h);
      tinted = canvas as unknown as CanvasImageSource;
      byTint.set(key, tinted);
    }
    source = tinted;
  }
  ctx.drawImage(source, c.f32(4), c.f32(5), c.f32(6), c.f32(7), c.f32(0), c.f32(1), c.f32(2), c.f32(3));
}
