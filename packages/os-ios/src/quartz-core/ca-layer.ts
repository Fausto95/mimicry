import { NO_RADII, withAlpha, type Radii } from '@mimicry/protocol';
import {
  RenderLayer, drawShadows, drawBorders, fitImage, hasRadii, inflate, multiply, shadowExtent, translation,
  type LayerContext, type Matrix, type ShadowSpec,
} from '@mimicry/os-core';
import type { CGPoint, CGRect, CGSize } from '../core-graphics/geometry';

/**
 * CALayer: Core Animation's layer, on the shared render tree. Besides
 * geometry it draws its own visual properties the way Core Animation does —
 * shadow, background (rounded by cornerRadius / maskedCorners), contents
 * image, the delegate's drawing (a view's `draw(_:)`), sublayers, and the
 * border on top.
 *
 * Geometry follows the frame model: `frame` is the untransformed box in the
 * superlayer, `transform` applies about `anchorPoint` (the center by default).
 */
export const CACornerMask = {
  layerMinXMinYCorner: 1,
  layerMaxXMinYCorner: 2,
  layerMinXMaxYCorner: 4,
  layerMaxXMaxYCorner: 8,
} as const;
const ALL_CORNERS = 15;

export type CALayerContentsGravity =
  | 'center' | 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  | 'resize' | 'resizeAspect' | 'resizeAspectFill';

/** What a CALayer's delegate (a UIView) may implement. */
export interface CALayerDelegate {
  /** layerWillDraw(_:) — resolve dynamic state before drawing */
  willDraw?(layer: CALayer): void;
  draw?(layer: CALayer, ctx: LayerContext): void;
  drawOverlay?(layer: CALayer, ctx: LayerContext): void;
}

export class CALayer extends RenderLayer {
  layerDelegate: CALayerDelegate | null = null;

  /** packed RGBA (CGColor) */
  backgroundColor: number | null = null;
  cornerRadius = 0;
  maskedCorners = ALL_CORNERS;
  cornerCurve: 'circular' | 'continuous' = 'circular';
  borderWidth = 0;
  borderColor = 0x000000ff;
  shadowColor = 0x000000ff;
  shadowOpacity = 0;
  shadowOffset: CGSize = { width: 0, height: -3 };
  shadowRadius = 3;
  /** an image URI the host has decoded (CGImage stand-in) */
  contents: { uri: string; width: number; height: number } | null = null;
  contentsGravity: CALayerContentsGravity = 'resize';
  /** tint for template images */
  contentsTint = 0;
  anchorPoint: CGPoint = { x: 0.5, y: 0.5 };
  private affine: Matrix | null = null;

  // ── geometry ──────────────────────────────────────────────────────────

  get frame(): CGRect {
    return { origin: { x: this.x, y: this.y }, size: { width: this.width, height: this.height } };
  }

  set frame(r: CGRect) {
    this.setFrame(r.origin.x, r.origin.y, r.size.width, r.size.height);
    this.updateTransform();
  }

  get position(): CGPoint {
    return { x: this.x + this.width * this.anchorPoint.x, y: this.y + this.height * this.anchorPoint.y };
  }

  set position(p: CGPoint) {
    this.x = p.x - this.width * this.anchorPoint.x;
    this.y = p.y - this.height * this.anchorPoint.y;
  }

  /** CALayer.bounds: origin is the content offset, size the box size */
  get boundsRect(): CGRect {
    return { origin: { x: this.originX, y: this.originY }, size: { width: this.width, height: this.height } };
  }

  set boundsRect(r: CGRect) {
    this.originX = r.origin.x;
    this.originY = r.origin.y;
    this.width = r.size.width;
    this.height = r.size.height;
    this.updateTransform();
  }

  /** setAffineTransform / affineTransform (about the anchor point) */
  get affineTransform(): Matrix | null {
    return this.affine;
  }

  set affineTransform(m: Matrix | null) {
    this.affine = m;
    this.updateTransform();
  }

  override setFrame(x: number, y: number, width: number, height: number): void {
    const resized = width !== this.width || height !== this.height;
    super.setFrame(x, y, width, height);
    if (resized) this.updateTransform();
  }

  private updateTransform(): void {
    const m = this.affine;
    if (!m) {
      this.transform = null;
      return;
    }
    const ax = this.width * this.anchorPoint.x;
    const ay = this.height * this.anchorPoint.y;
    this.transform = ax === 0 && ay === 0 ? m : multiply(translation(ax, ay), multiply(m, translation(-ax, -ay)));
  }

  /** The radii a rounded rect of this layer uses, honoring maskedCorners. */
  get radii(): Radii {
    const r = Math.max(0, Math.min(this.cornerRadius, this.width / 2, this.height / 2));
    if (r <= 0) return NO_RADII;
    const m = this.maskedCorners;
    return [
      m & CACornerMask.layerMinXMinYCorner ? r : 0,
      m & CACornerMask.layerMaxXMinYCorner ? r : 0,
      m & CACornerMask.layerMaxXMaxYCorner ? r : 0,
      m & CACornerMask.layerMinXMaxYCorner ? r : 0,
    ];
  }

  // ── drawing ───────────────────────────────────────────────────────────

  override drawContent(ctx: LayerContext): void {
    this.layerDelegate?.willDraw?.(this);
    const radii = this.radii;
    if (this.masksToBounds && this.cornerRadius > 0) this.cornerRadii = radii;
    const box = { x: ctx.x, y: ctx.y, w: this.width, h: this.height, radii };
    if (this.shadowOpacity > 0 && !this.masksToBounds) {
      const shadow: ShadowSpec = {
        color: withAlpha(this.shadowColor, this.shadowOpacity),
        blur: this.shadowRadius * 2,
        dx: this.shadowOffset.width,
        dy: this.shadowOffset.height,
        spread: 0,
        inset: false,
      };
      ctx.item(inflate(box, shadowExtent([shadow]) + 1), (w) => drawShadows(w, box, [shadow], false));
    }
    const bg = this.backgroundColor;
    if (bg != null && (bg & 255) !== 0) {
      ctx.item(box, (w) => (hasRadii(radii) ? w.fillRRect(box.x, box.y, box.w, box.h, radii, bg) : w.fillRect(box.x, box.y, box.w, box.h, bg)));
    }
    const contents = this.contents;
    if (contents && contents.width > 0 && contents.height > 0) {
      const mode = GRAVITY[this.contentsGravity] ?? 'stretch';
      ctx.item(box, (w) => {
        w.save();
        if (hasRadii(radii)) w.clipRRect(box.x, box.y, box.w, box.h, radii);
        else w.clipRect(box.x, box.y, box.w, box.h);
        const r = fitImage(mode, contents.width, contents.height, box);
        w.image(r.dx, r.dy, r.dw, r.dh, r.sx, r.sy, r.sw, r.sh, this.contentsTint, contents.uri);
        w.restore();
      });
    }
    this.layerDelegate?.draw?.(this, ctx);
    super.drawContent(ctx);
  }

  override drawOverlay(ctx: LayerContext): void {
    super.drawOverlay(ctx);
    this.layerDelegate?.drawOverlay?.(this, ctx);
    if (this.borderWidth > 0 && (this.borderColor & 255) !== 0) {
      const box = { x: ctx.x, y: ctx.y, w: this.width, h: this.height, radii: this.radii };
      const b = this.borderWidth;
      const c = this.borderColor;
      ctx.item(inflate(box, 1), (w) => drawBorders(w, box, { top: b, right: b, bottom: b, left: b, colors: [c, c, c, c], style: 'solid' }));
    }
  }
}

const GRAVITY: Record<string, string> = {
  resize: 'stretch',
  resizeAspect: 'contain',
  resizeAspectFill: 'cover',
  center: 'center',
};
