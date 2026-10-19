import { CommandWriter, type OverlayRecord, type Radii } from '@mimicry/protocol';
import {
  IDENTITY, hasRadii, multiply, transformRect, translation, union,
  type ClipEntry, type LayerContext, type Matrix, type Rect, type RenderLayer,
} from '@mimicry/os-core';
import { CALayer } from './ca-layer';

/**
 * Snapshots: a layer subtree recorded once into a self-contained command
 * stream, replayed by a SnapshotLayer as long as it lives. This is what
 * `snapshotView(afterScreenUpdates:)` returns and what cross-dissolve
 * transitions fade out (UIKit's CATransition captures the old rendering
 * the same way).
 *
 * The recording mirrors the render server's traversal, but folds layer
 * transforms and opacity into the stream instead of compositing them.
 * Backdrop materials cannot be captured (they are composite-time effects).
 */
export interface LayerSnapshot {
  bytes: Uint8Array;
  /** what the stream covers, in the snapshot layer's own coordinates */
  bounds: Rect;
}

export function recordLayerTree(layer: RenderLayer, scale: number): LayerSnapshot {
  const writer = new CommandWriter(4096);
  const recorder = new SnapshotRecorder(writer, scale);
  // The root draws in its own space: its frame origin and transform stay outside the snapshot.
  recorder.content(layer, 0, 0);
  return { bytes: writer.finish(), bounds: recorder.bounds ?? { x: 0, y: 0, w: layer.width, h: layer.height } };
}

class SnapshotRecorder {
  bounds: Rect | null = null;
  private matrix: Matrix = [...IDENTITY] as Matrix;
  private readonly matrices: Matrix[] = [];

  constructor(private readonly w: CommandWriter, private readonly scale: number) {}

  private layer(layer: RenderLayer, ox: number, oy: number): void {
    if (layer.hidden || layer.opacity <= 0) return;
    const own = layer.transform;
    const opacity = Math.min(1, layer.opacity);
    if (!own && opacity >= 1) {
      this.content(layer, ox, oy);
      return;
    }
    const m = own ? multiply(translation(ox, oy), own) : translation(ox, oy);
    this.save();
    this.concat(m);
    if (opacity < 1) this.w.alpha(opacity);
    this.content(layer, 0, 0);
    this.restore();
  }

  content(layer: RenderLayer, ox: number, oy: number): void {
    const ctx = this.context(ox, oy);
    layer.drawContent(ctx);
    const clip = layer.masksToBounds || layer.scrollsContent;
    if (layer.sublayers.length) {
      if (clip) this.clip({ x: ox, y: oy, w: layer.width, h: layer.height, radii: layer.cornerRadii });
      const dx = ox - layer.originX;
      const dy = oy - layer.originY;
      for (const sub of layer.orderedSublayers()) this.layer(sub, dx + sub.x, dy + sub.y);
      if (clip) this.restore();
    }
    for (const fixed of layer.fixedSublayers) this.layer(fixed, ox + fixed.x, oy + fixed.y);
    layer.drawOverlay(ctx);
  }

  private context(x: number, y: number): LayerContext {
    return {
      x,
      y,
      scale: this.scale,
      item: (bounds, draw) => {
        this.w.save();
        draw(this.w);
        this.w.restore();
        this.bounds = union(this.bounds, transformRect(this.matrix, bounds));
      },
      visible: (bounds) => bounds,
      pushClip: (clip: ClipEntry) => this.clip(clip),
      popClip: () => this.restore(),
      flush: () => {},
      backdrop: () => {},
      overlay: (_record: OverlayRecord) => {},
    };
  }

  private clip(c: { x: number; y: number; w: number; h: number; radii: Radii }): void {
    this.save();
    if (hasRadii(c.radii)) this.w.clipRRect(c.x, c.y, c.w, c.h, c.radii);
    else this.w.clipRect(c.x, c.y, c.w, c.h);
  }

  private save(): void {
    this.w.save();
    this.matrices.push(this.matrix);
  }

  private restore(): void {
    this.w.restore();
    this.matrix = this.matrices.pop() ?? ([...IDENTITY] as Matrix);
  }

  private concat(m: Matrix): void {
    this.w.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    this.matrix = multiply(this.matrix, m);
  }
}

/** A layer that replays a recorded snapshot (the contents of a snapshot view). */
export class SnapshotLayer extends CALayer {
  constructor(readonly snapshot: LayerSnapshot) {
    super();
    this.name = 'SnapshotLayer';
  }

  override drawContent(ctx: LayerContext): void {
    super.drawContent(ctx);
    const { bytes, bounds } = this.snapshot;
    if (!bytes.byteLength) return;
    ctx.item({ x: ctx.x + bounds.x, y: ctx.y + bounds.y, w: bounds.w, h: bounds.h }, (w) => {
      w.save();
      w.transform(1, 0, 0, 1, ctx.x, ctx.y);
      w.raw(bytes);
      w.restore();
    });
  }
}
