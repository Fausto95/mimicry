import { NO_RADII, withAlpha, type Radii } from '@mimicry/protocol';
import {
  IDENTITY, RenderLayer, drawShadows, drawBorders, fitImage, hasRadii, inflate, multiply, shadowExtent, translation,
  type LayerContext, type Matrix, type ShadowSpec,
} from '@mimicry/os-core';
import type { CGPoint, CGRect, CGSize } from '../core-graphics/geometry';
import { GEOMETRY_KEYS, type LayerState } from './animatable';
import type { CAAnimation } from './ca-animation';
import { kernelOf, mediaNow } from './ca-media-time';
import { CATransaction, type TransactionToken } from './ca-transaction';
import { animationCensus, scheduleAnimations } from './render-animations';

/**
 * CALayer: Core Animation's layer, on the shared render tree. Besides
 * geometry it draws its own visual properties the way Core Animation does —
 * shadow, background (rounded by cornerRadius / maskedCorners), contents
 * image, the delegate's drawing (a view's `draw(_:)`), sublayers, and the
 * border on top.
 *
 * Geometry follows the frame model: `frame` is the untransformed box in the
 * superlayer, `transform` applies about `anchorPoint` (the center by default).
 *
 * Animations (`add(_:forKey:)`) never touch the model values: while the tree
 * is drawn, each layer puts its sublayers' presentation values (model plus
 * running animations) into the render fields the render server reads, and
 * puts the model back once they are drawn. A layer moving or resizing that
 * way composites on its own, so its parent's rasters stay valid.
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

interface AttachedAnimation {
  key: string | null;
  animation: CAAnimation;
  token: TransactionToken;
  started: boolean;
  stopped: boolean;
}

/** The render fields a presentation swap overwrites while the tree is drawn. */
interface RenderFields {
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  transform: Matrix | null;
  opacity: number;
  zIndex: number;
  composited: boolean;
}

/**
 * @internal UIKit's animation blocks watch CALayer property changes made
 * inside them (UIView.animate animates `layer.cornerRadius`, iOS 11+).
 */
export const layerActions = {
  willChange: null as ((layer: CALayer, key: string, oldValue: unknown) => void) | null,
};

export class CALayer extends RenderLayer {
  layerDelegate: CALayerDelegate | null = null;

  /** packed RGBA (CGColor) */
  backgroundColor: number | null = null;
  private _cornerRadius = 0;
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

  private readonly attached: AttachedAnimation[] = [];
  /** sublayers whose presentation values are in their render fields right now */
  private swapped: Array<[CALayer, RenderFields]> | null = null;
  /** the presentation state this layer draws its own properties with, while it draws */
  private drawing: LayerState | null = null;

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

  get cornerRadius(): number {
    return this._cornerRadius;
  }

  set cornerRadius(r: number) {
    if (r === this._cornerRadius) return;
    layerActions.willChange?.(this, 'cornerRadius', this._cornerRadius);
    this._cornerRadius = r;
    this.setNeedsDisplay();
  }

  /** CALayer.zPosition (sibling paint order) */
  get zPosition(): number {
    return this.zIndex;
  }

  set zPosition(z: number) {
    this.zIndex = z;
    this.setNeedsDisplay();
  }

  override setFrame(x: number, y: number, width: number, height: number): void {
    const resized = width !== this.width || height !== this.height;
    super.setFrame(x, y, width, height);
    if (resized) this.updateTransform();
  }

  private updateTransform(): void {
    this.transform = anchoredTransform(this.affine, this.width, this.height, this.anchorPoint.x, this.anchorPoint.y);
  }

  /** The radii a rounded rect of this layer uses, honoring maskedCorners. */
  get radii(): Radii {
    return this.radiiFor(this._cornerRadius, this.width, this.height);
  }

  private radiiFor(radius: number, width: number, height: number): Radii {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    if (r <= 0) return NO_RADII;
    const m = this.maskedCorners;
    return [
      m & CACornerMask.layerMinXMinYCorner ? r : 0,
      m & CACornerMask.layerMaxXMinYCorner ? r : 0,
      m & CACornerMask.layerMaxXMaxYCorner ? r : 0,
      m & CACornerMask.layerMinXMaxYCorner ? r : 0,
    ];
  }

  // ── animations ────────────────────────────────────────────────────────

  /**
   * Attach a copy of `animation`. An animation with the same key is
   * removed first; a zero beginTime means "now", a zero duration the
   * transaction's.
   */
  add(animation: CAAnimation, forKey: string | null = null): void {
    if (animation._keyPaths().length === 0) throw new Error('CALayer.add(_:forKey:): the animation has no key path');
    if (forKey !== null) this.removeAnimation(forKey);
    const copy = animation.copy();
    const kernel = kernelOf(this.root.host);
    if (copy.beginTime === 0) copy.beginTime = mediaNow(kernel) / 1000;
    if (copy.duration === 0) copy.duration = CATransaction.animationDuration();
    if (!copy.timingFunction) copy.timingFunction = CATransaction.animationTimingFunction();
    if (this.attached.length === 0) animationCensus.layers++;
    this.attached.push({ key: forKey, animation: copy, token: CATransaction._track(), started: false, stopped: false });
    if (kernel) scheduleAnimations(kernel, this);
    this.setNeedsDisplay();
  }

  removeAnimation(forKey: string): void {
    const at = this.attached.findIndex((a) => a.key === forKey);
    if (at >= 0) this.detachAnimation(at, false);
  }

  removeAllAnimations(): void {
    while (this.attached.length) this.detachAnimation(this.attached.length - 1, false);
  }

  /** Keys of the attached animations (null when there are none, like CA's nil). */
  animationKeys(): string[] | null {
    const keys = this.attached.filter((a) => a.key !== null).map((a) => a.key!);
    return keys.length ? keys : null;
  }

  animation(forKey: string): CAAnimation | null {
    return this.attached.find((a) => a.key === forKey)?.animation ?? null;
  }

  /** Whether any animation is attached (Mimicry; tests and UIKit). */
  get hasAnimations(): boolean {
    return this.attached.length > 0;
  }

  private detachAnimation(at: number, finished: boolean): void {
    const [entry] = this.attached.splice(at, 1);
    if (!entry) return;
    if (this.attached.length === 0) animationCensus.layers--;
    if (!entry.stopped) {
      entry.stopped = true;
      entry.animation.delegate?.animationDidStop?.(entry.animation, finished);
    }
    entry.token.release();
    this.setNeedsDisplay();
  }

  /** @internal the render server's per-frame step */
  _stepAnimations(nowMs: number): boolean {
    const now = nowMs / 1000;
    // Delegates may add or remove animations while being told about these.
    for (const entry of this.attached.slice()) {
      if (entry.stopped || !this.attached.includes(entry)) continue;
      const time = entry.animation.localTime(now);
      if (!entry.started && time.phase !== 'before') {
        entry.started = true;
        entry.animation.delegate?.animationDidStart?.(entry.animation);
      }
      if (time.phase !== 'after') continue;
      if (entry.animation.isRemovedOnCompletion) {
        this.detachAnimation(this.attached.indexOf(entry), true);
      } else {
        entry.stopped = true;
        entry.animation.delegate?.animationDidStop?.(entry.animation, true);
        entry.token.release();
      }
    }
    return this.attached.some((a) => !a.stopped);
  }

  /** @internal the model values as a state record */
  _modelState(): LayerState {
    const m = this.affine ?? IDENTITY;
    return {
      positionX: this.x + this.width * this.anchorPoint.x,
      positionY: this.y + this.height * this.anchorPoint.y,
      originX: this.originX,
      originY: this.originY,
      width: this.width,
      height: this.height,
      anchorX: this.anchorPoint.x,
      anchorY: this.anchorPoint.y,
      affine: [m[0], m[1], m[2], m[3], m[4], m[5]],
      opacity: this.opacity,
      zPosition: this.zIndex,
      backgroundColor: this.backgroundColor,
      cornerRadius: this._cornerRadius,
      borderWidth: this.borderWidth,
      borderColor: this.borderColor,
      shadowColor: this.shadowColor,
      shadowOpacity: this.shadowOpacity,
      shadowRadius: this.shadowRadius,
      shadowOffsetWidth: this.shadowOffset.width,
      shadowOffsetHeight: this.shadowOffset.height,
    };
  }

  /** @internal model plus every attached animation at `nowMs` (media time; now when omitted) */
  _presentationState(nowMs?: number): LayerState {
    const state = this._modelState();
    if (!this.attached.length) return state;
    nowMs ??= mediaNow(kernelOf(this.root.host));
    const now = nowMs / 1000;
    for (const entry of this.attached) entry.animation._apply(state, now);
    return state;
  }

  /**
   * presentation(): a copy of the layer as it currently appears on screen —
   * the model with the running animations applied.
   */
  presentation(): CALayer {
    const copy = new CALayer();
    copy.anchorPoint = { ...this.anchorPoint };
    copy.maskedCorners = this.maskedCorners;
    copy.cornerCurve = this.cornerCurve;
    copy.contents = this.contents;
    copy.contentsGravity = this.contentsGravity;
    copy.contentsTint = this.contentsTint;
    copy.masksToBounds = this.masksToBounds;
    copy.hidden = this.hidden;
    copy.name = this.name;
    const state = this.attached.length ? this._presentationState(mediaNow(kernelOf(this.root.host))) : this._modelState();
    copy.applyState(state);
    return copy;
  }

  /** model(): this layer (the model layer of a presentation copy is not tracked). */
  model(): CALayer {
    return this;
  }

  private applyState(s: LayerState): void {
    this.anchorPoint = { x: s.anchorX, y: s.anchorY };
    this.setFrame(s.positionX - s.width * s.anchorX, s.positionY - s.height * s.anchorY, s.width, s.height);
    this.originX = s.originX;
    this.originY = s.originY;
    this.opacity = s.opacity;
    this.zIndex = s.zPosition;
    this.affineTransform = isIdentity(s.affine) ? null : s.affine;
    this.backgroundColor = s.backgroundColor;
    this._cornerRadius = s.cornerRadius;
    this.borderWidth = s.borderWidth;
    this.borderColor = s.borderColor;
    this.shadowColor = s.shadowColor;
    this.shadowOpacity = s.shadowOpacity;
    this.shadowRadius = s.shadowRadius;
    this.shadowOffset = { width: s.shadowOffsetWidth, height: s.shadowOffsetHeight };
  }

  /** Put presentation values into the render fields of animated sublayers (until drawOverlay). */
  private swapInPresentation(): void {
    if (animationCensus.layers === 0) return;
    let now: number | null = null;
    const visit = (list: readonly RenderLayer[]) => {
      for (const sub of list) {
        if (!(sub instanceof CALayer) || sub.attached.length === 0) continue;
        now ??= mediaNow(kernelOf(this.root.host));
        const s = sub._presentationState(now);
        const saved: RenderFields = {
          x: sub.x, y: sub.y, width: sub.width, height: sub.height, originX: sub.originX, originY: sub.originY,
          transform: sub.transform, opacity: sub.opacity, zIndex: sub.zIndex, composited: sub.composited,
        };
        (this.swapped ??= []).push([sub, saved]);
        sub.x = s.positionX - s.width * s.anchorX;
        sub.y = s.positionY - s.height * s.anchorY;
        sub.width = s.width;
        sub.height = s.height;
        sub.originX = s.originX;
        sub.originY = s.originY;
        sub.transform = anchoredTransform(isIdentity(s.affine) ? null : s.affine, s.width, s.height, s.anchorX, s.anchorY);
        sub.opacity = s.opacity;
        sub.zIndex = s.zPosition;
        if (sub.attached.some((a) => a.animation._keyPaths().some((k) => GEOMETRY_KEYS.has(k)))) sub.composited = true;
      }
    };
    visit(this.sublayers);
    visit(this.fixedSublayers);
  }

  private restoreModel(): void {
    const swapped = this.swapped;
    if (!swapped) return;
    this.swapped = null;
    for (const [sub, f] of swapped) {
      sub.x = f.x;
      sub.y = f.y;
      sub.width = f.width;
      sub.height = f.height;
      sub.originX = f.originX;
      sub.originY = f.originY;
      sub.transform = f.transform;
      sub.opacity = f.opacity;
      sub.zIndex = f.zIndex;
      sub.composited = f.composited;
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────

  override drawContent(ctx: LayerContext): void {
    this.swapInPresentation();
    this.layerDelegate?.willDraw?.(this);
    // The layer's own animated properties (its geometry was swapped in by its superlayer).
    this.drawing = this.attached.length ? this._presentationState(mediaNow(kernelOf(this.root.host))) : null;
    const look = this.drawing;
    const cornerRadius = look ? look.cornerRadius : this._cornerRadius;
    const radii = this.radiiFor(cornerRadius, this.width, this.height);
    if (this.masksToBounds && cornerRadius > 0) this.cornerRadii = radii;
    const box = { x: ctx.x, y: ctx.y, w: this.width, h: this.height, radii };
    const shadowOpacity = look ? look.shadowOpacity : this.shadowOpacity;
    if (shadowOpacity > 0 && !this.masksToBounds) {
      const shadow: ShadowSpec = {
        color: withAlpha(look ? look.shadowColor : this.shadowColor, shadowOpacity),
        blur: (look ? look.shadowRadius : this.shadowRadius) * 2,
        dx: look ? look.shadowOffsetWidth : this.shadowOffset.width,
        dy: look ? look.shadowOffsetHeight : this.shadowOffset.height,
        spread: 0,
        inset: false,
      };
      ctx.item(inflate(box, shadowExtent([shadow]) + 1), (w) => drawShadows(w, box, [shadow], false));
    }
    const bg = look ? look.backgroundColor : this.backgroundColor;
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
    const look = this.drawing;
    const borderWidth = look ? look.borderWidth : this.borderWidth;
    const borderColor = look ? look.borderColor : this.borderColor;
    if (borderWidth > 0 && (borderColor & 255) !== 0) {
      const radii = this.radiiFor(look ? look.cornerRadius : this._cornerRadius, this.width, this.height);
      const box = { x: ctx.x, y: ctx.y, w: this.width, h: this.height, radii };
      const b = borderWidth;
      const c = borderColor;
      ctx.item(inflate(box, 1), (w) => drawBorders(w, box, { top: b, right: b, bottom: b, left: b, colors: [c, c, c, c], style: 'solid' }));
    }
    this.drawing = null;
    this.restoreModel();
  }
}

/** The render transform for an affine applied about an anchor point of a w×h box. */
function anchoredTransform(m: Matrix | null, width: number, height: number, anchorX: number, anchorY: number): Matrix | null {
  if (!m) return null;
  const ax = width * anchorX;
  const ay = height * anchorY;
  return ax === 0 && ay === 0 ? m : multiply(translation(ax, ay), multiply(m, translation(-ax, -ay)));
}

const isIdentity = (m: Readonly<Matrix>) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;

const GRAVITY: Record<string, string> = {
  resize: 'stretch',
  resizeAspect: 'contain',
  resizeAspectFill: 'cover',
  center: 'center',
};

