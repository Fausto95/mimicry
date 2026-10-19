import { FrameEncoder, NO_CLIP, type CommandWriter, type OverlayRecord, type Radii } from '@mimicry/protocol';
import { IDENTITY, multiply, translation, type Rect } from '../geometry/matrix';
import { LayerRecorder, type ClipEntry, type RecorderStats } from '../graphics/recorder';
import type { LayerContext, RenderLayer } from './layer';

/**
 * The screen: root layers (windows) stacked bottom to top. The OS keeps the
 * list ordered by window level (UIWindow.windowLevel, WindowManager layers).
 */
export class Display {
  readonly windows: RenderLayer[] = [];

  constructor(public width: number, public height: number, public scale: number) {}

  addWindow(layer: RenderLayer, level = 0): void {
    this.removeWindow(layer);
    levels.set(layer, level);
    let at = this.windows.length;
    while (at > 0 && (levels.get(this.windows[at - 1]!) ?? 0) > level) at--;
    this.windows.splice(at, 0, layer);
  }

  removeWindow(layer: RenderLayer): void {
    const at = this.windows.indexOf(layer);
    if (at >= 0) this.windows.splice(at, 1);
  }

  resize(width: number, height: number, scale: number): void {
    this.width = width;
    this.height = height;
    this.scale = scale;
  }
}

const levels = new WeakMap<RenderLayer, number>();

export interface FrameOutput {
  buffer: ArrayBuffer;
  stats: RecorderStats;
}

/** Composited sublayers the server creates for a layer, offset from its layerId. */
const SCROLL_CONTENT = 1;

/**
 * The render server (backboardd / SurfaceFlinger + the RenderThread): turns
 * the layer tree into one frame of the binary protocol.
 *
 * A layer becomes its own composited layer when it has a transform, group
 * opacity, is marked `composited`, or holds scrolled content; everything
 * else is recorded into the enclosing layer's chunks, which are hashed by
 * content so the host re-rasterizes only what changed. Layer properties
 * (transform, opacity, clip, scroll offset) are composite-time values:
 * animating them never invalidates a raster.
 */
export class RenderServer {
  private frameNumber = 0;

  render(display: Display): FrameOutput {
    const frame = new FrameEncoder(++this.frameNumber, display.width, display.height, display.scale);
    const stats: RecorderStats = { chunks: 0, layers: 0, culled: 0 };
    const screen = { x: 0, y: 0, w: display.width, h: display.height };
    frame.push(0, IDENTITY, 1, NO_CLIP);
    const root = new LayerRecorder(frame, display.scale, screen, stats);
    const pass = new Pass(frame, stats, display.scale);
    for (const window of display.windows) pass.layer(window, window.x, window.y, root);
    root.flush();
    frame.pop();
    return { buffer: frame.finish(), stats };
  }
}

class Pass {
  constructor(readonly frame: FrameEncoder, readonly stats: RecorderStats, readonly scale: number) {}

  layer(layer: RenderLayer, ox: number, oy: number, rec: LayerRecorder): void {
    if (layer.hidden || layer.opacity <= 0) return;
    const own = layer.transform;
    const opacity = Math.min(1, layer.opacity);
    if (own || opacity < 1 || layer.composited) {
      rec.flush();
      const m = own ? multiply(translation(ox, oy), own) : translation(ox, oy);
      this.frame.push(layer.layerId, m, opacity, rec.compositeClip());
      this.stats.layers++;
      const inner = new LayerRecorder(this.frame, this.scale, null, this.stats);
      this.content(layer, 0, 0, inner);
      inner.flush();
      this.frame.pop();
      return;
    }
    this.content(layer, ox, oy, rec);
  }

  private content(layer: RenderLayer, ox: number, oy: number, rec: LayerRecorder): void {
    const ctx = this.context(rec, ox, oy);
    layer.drawContent(ctx);
    if (layer.scrollsContent) {
      this.scrolled(layer, ox, oy, rec);
    } else if (layer.sublayers.length) {
      const clip = layer.masksToBounds;
      if (clip) rec.pushClip({ x: ox, y: oy, w: layer.width, h: layer.height, radii: layer.cornerRadii });
      const dx = ox - layer.originX;
      const dy = oy - layer.originY;
      for (const sub of layer.orderedSublayers()) this.layer(sub, dx + sub.x, dy + sub.y, rec);
      if (clip) rec.popClip();
    }
    for (const fixed of layer.fixedSublayers) this.layer(fixed, ox + fixed.x, oy + fixed.y, rec);
    layer.drawOverlay(ctx);
  }

  /** Scrolled content: one composited layer at the content offset, tiled by what is visible. */
  private scrolled(layer: RenderLayer, ox: number, oy: number, rec: LayerRecorder): void {
    rec.flush();
    rec.pushClip({ x: ox, y: oy, w: layer.width, h: layer.height, radii: layer.cornerRadii });
    const clip = rec.compositeClip();
    rec.popClip();
    const sx = layer.originX;
    const sy = layer.originY;
    this.frame.push(layer.layerId + SCROLL_CONTENT, translation(ox - sx, oy - sy), 1, clip);
    this.stats.layers++;
    // The visible region plus one viewport of prefetch either side, in content coordinates.
    const interest = { x: sx - layer.width, y: sy - layer.height, w: layer.width * 3, h: layer.height * 3 };
    const content = new LayerRecorder(this.frame, this.scale, interest, this.stats);
    for (const sub of layer.orderedSublayers()) this.layer(sub, sub.x, sub.y, content);
    content.flush();
    this.frame.pop();
  }

  private context(rec: LayerRecorder, x: number, y: number): LayerContext {
    const frame = this.frame;
    return {
      x,
      y,
      scale: this.scale,
      item: (bounds: Rect, draw: (w: CommandWriter) => void) => rec.item(bounds, draw),
      visible: (bounds: Rect) => rec.visible(bounds),
      pushClip: (clip: ClipEntry) => rec.pushClip(clip),
      popClip: () => rec.popClip(),
      flush: () => rec.flush(),
      backdrop: (rect: Rect, radii: Radii, blur: number, saturation: number) => {
        rec.flush();
        frame.backdrop(rect, radii, blur, saturation);
      },
      overlay: (record: OverlayRecord) => frame.overlay(record),
    };
  }
}
