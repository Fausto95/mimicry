import { CommandWriter, NO_CLIP, type ClipSpec, type FrameEncoder, type Radii } from '@mimicry/protocol';
import { intersect, union, type Rect } from '../geometry/matrix';
import { hasRadii } from './box';

/**
 * Records one layer's content.
 *
 * Content is a sequence of self-contained *items* (each carries the clips it
 * needs), grouped into *segments* separated by child layers so paint order is
 * preserved. Each segment becomes one chunk — or, when it is large and the
 * layer knows what is visible (scroll content), a set of tiles. Every chunk is
 * hashed by content, so the host re-rasterizes only what changed.
 */
export interface ClipEntry extends Rect {
  radii: Radii;
}

interface Item {
  start: number;
  end: number;
  bounds: Rect;
}

export interface RecorderStats {
  chunks: number;
  layers: number;
  culled: number;
}

const TILE_PIXELS = 1024;
/** segments larger than this (in device pixels) are tiled when visibility is known */
const TILE_THRESHOLD = 1536 * 1536;

export class LayerRecorder {
  private readonly writer = new CommandWriter(4096);
  private items: Item[] = [];
  private readonly clips: ClipEntry[] = [];
  private clipBounds: Rect | null = null;

  constructor(
    private readonly frame: FrameEncoder,
    private readonly scale: number,
    /** visible region in layer coordinates, when known */
    private readonly interest: Rect | null,
    private readonly stats: RecorderStats,
  ) {}

  pushClip(clip: ClipEntry): void {
    this.clips.push(clip);
    this.recomputeClip();
  }

  popClip(): void {
    this.clips.pop();
    this.recomputeClip();
  }

  private recomputeClip(): void {
    let r: Rect | null = null;
    for (const c of this.clips) {
      r = r ? intersect(r, c) ?? { x: c.x, y: c.y, w: 0, h: 0 } : { x: c.x, y: c.y, w: c.w, h: c.h };
    }
    this.clipBounds = r;
  }

  /** Clip to hand to a child layer's composite record (parent coordinates). */
  compositeClip(): ClipSpec {
    if (!this.clips.length || !this.clipBounds) return NO_CLIP;
    const innermost = this.clips[this.clips.length - 1]!;
    const nested = this.clips.length === 1 || this.clips.every((c) => contains(c, innermost));
    if (nested && hasRadii(innermost.radii)) {
      return { kind: 2, x: innermost.x, y: innermost.y, w: innermost.w, h: innermost.h, radii: innermost.radii };
    }
    const b = this.clipBounds;
    return { kind: 1, x: b.x, y: b.y, w: b.w, h: b.h, radii: [0, 0, 0, 0] };
  }

  /** visible bounds of a rect after clipping, or null when fully clipped */
  visible(bounds: Rect): Rect | null {
    let r: Rect | null = bounds;
    if (this.clipBounds) r = intersect(r, this.clipBounds);
    if (r && this.interest) r = intersect(r, this.interest);
    return r;
  }

  item(bounds: Rect, draw: (w: CommandWriter) => void): void {
    const visible = this.visible(bounds);
    if (!visible) {
      this.stats.culled++;
      return;
    }
    const w = this.writer;
    const start = w.byteLength;
    if (this.clips.length) {
      w.save();
      for (const c of this.clips) {
        if (hasRadii(c.radii)) w.clipRRect(c.x, c.y, c.w, c.h, c.radii);
        else w.clipRect(c.x, c.y, c.w, c.h);
      }
    }
    draw(w);
    if (this.clips.length) w.restore();
    this.items.push({ start, end: w.byteLength, bounds: visible });
  }

  /** Close the current segment: emit its chunk(s) into the frame. */
  flush(): void {
    if (!this.items.length) return;
    const bytes = this.writer.finish();
    let bounds: Rect | null = null;
    for (const item of this.items) bounds = union(bounds, item.bounds);
    const area = bounds!.w * bounds!.h * this.scale * this.scale;
    if (this.interest && area > TILE_THRESHOLD) this.emitTiles(bytes, bounds!);
    else this.emitChunk(bytes, this.snap(bounds!));
    this.items = [];
    this.writer.reset();
  }

  private emitChunk(bytes: Uint8Array, bounds: Rect): void {
    if (bounds.w <= 0 || bounds.h <= 0) return;
    const index = this.frame.addChunk(bytes, bounds);
    this.frame.drawChunk(index);
    this.stats.chunks++;
  }

  private emitTiles(bytes: Uint8Array, bounds: Rect): void {
    const tile = TILE_PIXELS / this.scale;
    const region = this.interest ? intersect(bounds, this.interest) : bounds;
    if (!region) return;
    const x0 = Math.floor(region.x / tile);
    const y0 = Math.floor(region.y / tile);
    const x1 = Math.ceil((region.x + region.w) / tile);
    const y1 = Math.ceil((region.y + region.h) / tile);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const rect = { x: tx * tile, y: ty * tile, w: tile, h: tile };
        let used: Rect | null = null;
        let size = 0;
        const picked: Item[] = [];
        for (const item of this.items) {
          if (intersect(item.bounds, rect)) {
            picked.push(item);
            size += item.end - item.start;
            used = union(used, item.bounds);
          }
        }
        if (!picked.length || !used) continue;
        const out = new Uint8Array(size);
        let at = 0;
        for (const item of picked) {
          out.set(bytes.subarray(item.start, item.end), at);
          at += item.end - item.start;
        }
        const clipped = intersect(used, rect);
        if (clipped) this.emitChunk(out, this.snap(clipped));
      }
    }
  }

  /** Expand to whole device pixels so rasters align with the screen grid. */
  private snap(r: Rect): Rect {
    const s = this.scale;
    const x = Math.floor(r.x * s) / s;
    const y = Math.floor(r.y * s) / s;
    return { x, y, w: Math.ceil((r.x + r.w) * s) / s - x, h: Math.ceil((r.y + r.h) * s) / s - y };
  }
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
