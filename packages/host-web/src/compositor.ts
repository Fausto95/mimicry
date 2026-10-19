import { CommandCursor, CompositeOp, type ChunkRecord, type DecodedFrame } from '@mimicry/protocol';
import { execute, type CanvasFactory, type Ctx2D, type ImageSourceProvider } from './execute';

/**
 * Composites a frame. Every chunk is rasterized once into an offscreen canvas
 * keyed by its content hash and drawn from that raster on later frames — a
 * scroll, an opacity fade or a transform animation is pure compositing.
 */
interface Raster {
  canvas: { width: number; height: number; getContext(type: '2d'): Ctx2D | null };
  bytes: number;
  lastUsed: number;
}

export interface CompositorStats {
  hits: number;
  misses: number;
  direct: number;
  rasterMs: number;
  compositeMs: number;
  cachedBytes: number;
  cachedChunks: number;
}

export interface CompositorOptions {
  canvases: CanvasFactory;
  images: ImageSourceProvider;
  /** raster cache budget (bytes of RGBA) */
  cacheBudget?: number;
  /** chunks larger than this many pixels are painted directly, never cached */
  maxRasterPixels?: number;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: readonly number[]): M => [
  m[0] * n[0]! + m[2] * n[1]!,
  m[1] * n[0]! + m[3] * n[1]!,
  m[0] * n[2]! + m[2] * n[3]!,
  m[1] * n[2]! + m[3] * n[3]!,
  m[0] * n[4]! + m[2] * n[5]! + m[4],
  m[1] * n[4]! + m[3] * n[5]! + m[5],
];

export class Compositor {
  private readonly cache = new Map<number, Raster>();
  private cachedBytes = 0;
  private frameNo = 0;
  private pixelRatio = 0;
  private readonly budget: number;
  private readonly maxRaster: number;
  private scratch: Array<{ canvas: Raster['canvas']; ctx: Ctx2D }> = [];
  stats: CompositorStats = { hits: 0, misses: 0, direct: 0, rasterMs: 0, compositeMs: 0, cachedBytes: 0, cachedChunks: 0 };

  constructor(private readonly options: CompositorOptions) {
    this.budget = options.cacheBudget ?? 192 * 1024 * 1024;
    this.maxRaster = options.maxRasterPixels ?? 4096 * 4096;
  }

  /** Drop every raster (e.g. when fonts finish loading). */
  invalidate(): void {
    this.cache.clear();
    this.cachedBytes = 0;
  }

  /** Forget rasters that reference an image (it was replaced). */
  invalidateAll(): void {
    this.invalidate();
  }

  paint(target: Ctx2D, frame: DecodedFrame, pixelRatio: number, width: number, height: number): CompositorStats {
    const t0 = now();
    this.frameNo++;
    if (pixelRatio !== this.pixelRatio) {
      this.invalidate();
      this.pixelRatio = pixelRatio;
    }
    const stats: CompositorStats = { hits: 0, misses: 0, direct: 0, rasterMs: 0, compositeMs: 0, cachedBytes: 0, cachedChunks: 0 };
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.clearRect(0, 0, width, height);

    const cursor = new CommandCursor(frame.bytes, frame.compositeStart, frame.compositeEnd);
    // Each open layer: accumulated matrix (logical → device px), alpha, and an optional group surface.
    type Level = { m: M; alpha: number; ctx: Ctx2D; group: { canvas: Raster['canvas']; ctx: Ctx2D; alpha: number } | null };
    const base: M = [pixelRatio, 0, 0, pixelRatio, 0, 0];
    const stack: Level[] = [{ m: base, alpha: 1, ctx: target, group: null }];
    const groupNeeded = this.groupLayers(frame);

    while (cursor.next()) {
      const top = stack[stack.length - 1]!;
      if (cursor.op === CompositeOp.Push) {
        const layerId = cursor.u32(0);
        const local = [cursor.f32(1), cursor.f32(2), cursor.f32(3), cursor.f32(4), cursor.f32(5), cursor.f32(6)];
        const opacity = cursor.f32(7);
        const clipKind = cursor.u32(8);
        const ctx = top.ctx;
        ctx.save();
        if (clipKind) {
          setMatrix(ctx, top.m);
          ctx.beginPath();
          const x = cursor.f32(9);
          const y = cursor.f32(10);
          const w = cursor.f32(11);
          const h = cursor.f32(12);
          if (clipKind === 2 && typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(x, y, w, h, [cursor.f32(13), cursor.f32(14), cursor.f32(15), cursor.f32(16)]);
          } else ctx.rect(x, y, w, h);
          ctx.clip();
        }
        const m = mul(top.m, local);
        if (opacity < 1 && groupNeeded.has(layerId)) {
          // Group opacity: render the layer into a surface, then composite it once.
          const surface = this.scratchSurface(stack.length, width, height);
          surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
          surface.ctx.globalAlpha = 1;
          surface.ctx.clearRect(0, 0, width, height);
          stack.push({ m, alpha: 1, ctx: surface.ctx, group: { ...surface, alpha: opacity * top.alpha } });
        } else {
          stack.push({ m, alpha: top.alpha * opacity, ctx, group: null });
        }
      } else if (cursor.op === CompositeOp.Chunk) {
        const chunk = frame.chunks[cursor.u32(0)];
        if (chunk) this.drawChunk(top.ctx, frame, chunk, top.m, top.alpha, pixelRatio, stats);
      } else if (cursor.op === CompositeOp.Pop) {
        const level = stack.pop()!;
        const parent = stack[stack.length - 1]!;
        if (level.group) {
          parent.ctx.save();
          parent.ctx.setTransform(1, 0, 0, 1, 0, 0);
          parent.ctx.globalAlpha = level.group.alpha;
          parent.ctx.drawImage(level.group.canvas as unknown as CanvasImageSource, 0, 0);
          parent.ctx.restore();
        }
        parent.ctx.restore();
      }
    }
    this.evict();
    stats.cachedBytes = this.cachedBytes;
    stats.cachedChunks = this.cache.size;
    stats.compositeMs = now() - t0 - stats.rasterMs;
    this.stats = stats;
    return stats;
  }

  /** Layers whose opacity must be applied to the group (more than one draw inside). */
  private groupLayers(frame: DecodedFrame): Set<number> {
    const out = new Set<number>();
    const cursor = new CommandCursor(frame.bytes, frame.compositeStart, frame.compositeEnd);
    const stack: Array<{ id: number; opacity: number; draws: number }> = [];
    while (cursor.next()) {
      if (cursor.op === CompositeOp.Push) {
        stack.push({ id: cursor.u32(0), opacity: cursor.f32(7), draws: 0 });
      } else if (cursor.op === CompositeOp.Chunk) {
        const top = stack[stack.length - 1];
        if (top) top.draws++;
      } else if (cursor.op === CompositeOp.Pop) {
        const level = stack.pop()!;
        if (level.opacity < 1 && level.draws > 1) out.add(level.id);
        // a nested layer's draws overlap within the parent too
        const parent = stack[stack.length - 1];
        if (parent) parent.draws += Math.max(1, level.draws);
      }
    }
    return out;
  }

  private scratchSurface(depth: number, width: number, height: number) {
    let s = this.scratch[depth];
    if (!s || s.canvas.width !== width || s.canvas.height !== height) {
      const canvas = this.options.canvases.create(width, height);
      s = { canvas, ctx: canvas.getContext('2d')! };
      this.scratch[depth] = s;
    }
    return s;
  }

  private drawChunk(ctx: Ctx2D, frame: DecodedFrame, chunk: ChunkRecord, m: M, alpha: number, pr: number, stats: CompositorStats): void {
    const pw = Math.round(chunk.w * pr);
    const ph = Math.round(chunk.h * pr);
    if (pw <= 0 || ph <= 0) return;
    ctx.globalAlpha = alpha;
    if (pw * ph > this.maxRaster) {
      // Too large to cache: paint the commands straight onto the target.
      stats.direct++;
      ctx.save();
      setMatrix(ctx, m);
      ctx.beginPath();
      ctx.rect(chunk.x, chunk.y, chunk.w, chunk.h);
      ctx.clip();
      execute(ctx, frame.bytes, chunk.start, chunk.end, { pixelRatio: pr, images: this.options.images, canvases: this.options.canvases });
      ctx.restore();
      return;
    }
    let raster = this.cache.get(chunk.hash);
    if (raster) {
      stats.hits++;
    } else {
      stats.misses++;
      const t = now();
      const canvas = this.options.canvases.create(pw, ph);
      const rctx = canvas.getContext('2d')!;
      // chunk coordinates → raster pixels
      rctx.setTransform(pw / chunk.w, 0, 0, ph / chunk.h, -chunk.x * (pw / chunk.w), -chunk.y * (ph / chunk.h));
      execute(rctx, frame.bytes, chunk.start, chunk.end, { pixelRatio: pr, images: this.options.images, canvases: this.options.canvases });
      raster = { canvas, bytes: pw * ph * 4, lastUsed: this.frameNo };
      this.cache.set(chunk.hash, raster);
      this.cachedBytes += raster.bytes;
      stats.rasterMs += now() - t;
    }
    raster.lastUsed = this.frameNo;
    const translationOnly = m[0] === pr && m[1] === 0 && m[2] === 0 && m[3] === pr;
    if (translationOnly) {
      // Snap to device pixels so cached rasters stay crisp while scrolling.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dx = Math.round(m[4] + chunk.x * pr);
      const dy = Math.round(m[5] + chunk.y * pr);
      ctx.drawImage(raster.canvas as unknown as CanvasImageSource, dx, dy);
    } else {
      setMatrix(ctx, m);
      ctx.drawImage(raster.canvas as unknown as CanvasImageSource, chunk.x, chunk.y, chunk.w, chunk.h);
    }
  }

  private evict(): void {
    if (this.cachedBytes <= this.budget) return;
    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [hash, raster] of entries) {
      if (this.cachedBytes <= this.budget * 0.8) break;
      if (raster.lastUsed === this.frameNo) continue;
      this.cache.delete(hash);
      this.cachedBytes -= raster.bytes;
      const c = raster.canvas as { width: number; height: number };
      c.width = 0;
      c.height = 0;
    }
  }
}

function setMatrix(ctx: Ctx2D, m: M): void {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
