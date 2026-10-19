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

function rrectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): void {
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
