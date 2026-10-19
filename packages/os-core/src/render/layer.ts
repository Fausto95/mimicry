import { NO_RADII, type OverlayRecord, type Radii } from '@mimicry/protocol';
import { IDENTITY, apply, invert, multiply, transformRect, translation, type Matrix, type Rect } from '../geometry/matrix';
import type { ClipEntry } from '../graphics/recorder';

/**
 * The retained render tree both simulated operating systems draw through:
 * Core Animation's CALayer on iOS, the RenderNode behind every android.view.View.
 *
 * A layer has a frame in its superlayer's coordinate space, an optional
 * bounds origin (a scroll view's content offset), a transform, an opacity,
 * a z order among its siblings and an optional clip. What it draws comes from
 * its delegate, which records draw commands through a {@link LayerContext}.
 *
 * Layers never decide what becomes a GPU layer; the render server does (see
 * render-server.ts): a transform, group opacity or `composited` gets its own
 * composited layer, everything else is recorded into the enclosing one.
 */
export interface LayerDelegate {
  /** content under the sublayers (background, text, image…) */
  drawLayer?(layer: RenderLayer, ctx: LayerContext): void;
  /** content above the sublayers (foreground ripples, iOS uniform borders) */
  drawLayerOverlay?(layer: RenderLayer, ctx: LayerContext): void;
}

/** A layer's view of the recorder while it draws. Coordinates are recorder space. */
export interface LayerContext {
  /** the layer's top-left in recorder space */
  readonly x: number;
  readonly y: number;
  /** device pixels per point */
  readonly scale: number;
  /** record one self-contained draw item covering `bounds` */
  item(bounds: Rect, draw: (w: import('@mimicry/protocol').CommandWriter) => void): void;
  /** `bounds` after clipping and culling, or null when nothing of it shows */
  visible(bounds: Rect): Rect | null;
  pushClip(clip: ClipEntry): void;
  popClip(): void;
  /** end the current chunk (the next item starts a new raster) */
  flush(): void;
  /** blur what is already composited beneath `rect` (a composite-time material) */
  backdrop(rect: Rect, radii: Radii, blur: number, saturation: number): void;
  /** a native control the host mounts over the canvas (text fields) */
  overlay(record: OverlayRecord): void;
}

/** Notified when a layer tree needs a new frame. */
export interface LayerHost {
  layerNeedsDisplay(layer: RenderLayer): void;
}

let nextLayerId = 1;

export class RenderLayer {
  /**
   * Unique per layer; multiples of 8 so a layer can name the composited
   * sublayers the render server makes for it (scroll content, indicators).
   */
  readonly layerId = nextLayerId++ * 8;
  name = '';
  superlayer: RenderLayer | null = null;
  readonly sublayers: RenderLayer[] = [];
  /** drawn above the sublayers in this layer's own space, ignoring the bounds origin (scroll indicators) */
  readonly fixedSublayers: RenderLayer[] = [];
  delegate: LayerDelegate | null = null;
  /** set on root layers (windows): who is told when something needs a frame */
  host: LayerHost | null = null;

  /** frame in the superlayer's coordinate space */
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  /** bounds origin: sublayers draw at (x - originX, y - originY) — a scroll offset */
  originX = 0;
  originY = 0;
  /** applied about the layer's top-left corner (callers fold in their anchor point) */
  transform: Matrix | null = null;
  opacity = 1;
  hidden = false;
  /** paint order among siblings (CALayer.zPosition, View Z / RN zIndex) */
  zIndex = 0;
  masksToBounds = false;
  /** corner radii of the clip when masksToBounds is set */
  cornerRadii: Radii = NO_RADII;
  /** always composite on its own (shouldRasterize, hardware layers, animated presentation) */
  composited = false;
  /**
   * The sublayers are scrolled content: they go into their own composited
   * layer, offset by the bounds origin and tiled by the visible region.
   */
  scrollsContent = false;

  // ── tree ──────────────────────────────────────────────────────────────

  addSublayer(layer: RenderLayer): void {
    this.insertSublayer(layer, this.sublayers.length);
  }

  insertSublayer(layer: RenderLayer, index: number): void {
    layer.removeFromSuperlayer();
    const at = Math.max(0, Math.min(index, this.sublayers.length));
    this.sublayers.splice(at, 0, layer);
    layer.superlayer = this;
    this.setNeedsDisplay();
  }

  insertSublayerBelow(layer: RenderLayer, sibling: RenderLayer | null): void {
    const at = sibling ? this.sublayers.indexOf(sibling) : -1;
    this.insertSublayer(layer, at < 0 ? this.sublayers.length : at);
  }

  insertSublayerAbove(layer: RenderLayer, sibling: RenderLayer | null): void {
    const at = sibling ? this.sublayers.indexOf(sibling) : -1;
    this.insertSublayer(layer, at < 0 ? this.sublayers.length : at + 1);
  }

  addFixedSublayer(layer: RenderLayer): void {
    layer.removeFromSuperlayer();
    this.fixedSublayers.push(layer);
    layer.superlayer = this;
  }

  removeFromSuperlayer(): void {
    const parent = this.superlayer;
    if (!parent) return;
    let at = parent.sublayers.indexOf(this);
    if (at >= 0) parent.sublayers.splice(at, 1);
    at = parent.fixedSublayers.indexOf(this);
    if (at >= 0) parent.fixedSublayers.splice(at, 1);
    this.superlayer = null;
    parent.setNeedsDisplay();
  }

  /** Sublayers in paint order: ascending zIndex, document order among equals. */
  orderedSublayers(): readonly RenderLayer[] {
    const list = this.sublayers;
    let sorted = true;
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.zIndex < list[i - 1]!.zIndex) {
        sorted = false;
        break;
      }
    }
    if (sorted) return list;
    return list.map((l, i) => ({ l, i })).sort((a, b) => a.l.zIndex - b.l.zIndex || a.i - b.i).map((x) => x.l);
  }

  get root(): RenderLayer {
    let l: RenderLayer = this;
    while (l.superlayer) l = l.superlayer;
    return l;
  }

  /** Something this layer draws changed: ask its tree's host for a frame. */
  setNeedsDisplay(): void {
    const root = this.root;
    root.host?.layerNeedsDisplay(this);
  }

  // ── geometry ──────────────────────────────────────────────────────────

  get bounds(): Rect {
    return { x: this.originX, y: this.originY, w: this.width, h: this.height };
  }

  setFrame(x: number, y: number, width: number, height: number): void {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  /** This layer's space → its superlayer's space. */
  localMatrix(): Matrix {
    const parent = this.superlayer;
    const fixed = parent ? parent.fixedSublayers.includes(this) : false;
    const ox = parent && !fixed ? parent.originX : 0;
    const oy = parent && !fixed ? parent.originY : 0;
    const m = translation(this.x - ox, this.y - oy);
    return this.transform ? multiply(m, this.transform) : m;
  }

  /** This layer's space → the root layer's (window) space. */
  windowMatrix(): Matrix {
    let m = this.localMatrix();
    for (let l = this.superlayer; l; l = l.superlayer) m = multiply(l.localMatrix(), m);
    return m;
  }

  /** The layer's box in window space (axis-aligned bounds when transformed). */
  windowRect(): Rect {
    return transformRect(this.windowMatrix(), { x: 0, y: 0, w: this.width, h: this.height });
  }

  /** A point in window space → this layer's space. */
  convertFromWindow(x: number, y: number): [number, number] {
    const inv = invert(this.windowMatrix());
    return inv ? apply(inv, x, y) : [x, y];
  }

  /** A point in this layer's space → `other`'s space (window space when null). */
  convertPoint(x: number, y: number, other: RenderLayer | null): [number, number] {
    const [wx, wy] = apply(this.windowMatrix(), x, y);
    return other ? other.convertFromWindow(wx, wy) : [wx, wy];
  }
}

export { IDENTITY };
