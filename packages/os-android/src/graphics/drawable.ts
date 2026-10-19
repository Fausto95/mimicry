import { withAlpha, type CommandWriter, type Radii } from '@mimicry/protocol';
import { easeOut, type FrameTask, type Kernel } from '@mimicry/os-core';
import { Canvas, RectF } from './canvas';
import { Color } from './color';
import type { Outline } from '../view/outline';

/**
 * android.graphics.drawable: Drawable, ColorDrawable, GradientDrawable and
 * RippleDrawable (Material press feedback: the ripple grows from the touch
 * hotspot over 225 ms and fades 150 ms after release, never before 120 ms).
 */
export interface DrawableCallback {
  invalidateDrawable(who: Drawable): void;
  /** the kernel animations run on (the View's attach info) */
  drawableKernel(): Kernel | null;
}

export const StateSet = {
  pressed: 'state_pressed',
  enabled: 'state_enabled',
  focused: 'state_focused',
  selected: 'state_selected',
  checked: 'state_checked',
} as const;

export abstract class Drawable {
  private bounds = new RectF();
  private callback: DrawableCallback | null = null;
  protected state: readonly string[] = [];
  protected alpha = 255;

  setBounds(left: number, top: number, right: number, bottom: number): void {
    this.bounds.set(left, top, right, bottom);
  }

  getBounds(): RectF {
    return this.bounds;
  }

  setCallback(callback: DrawableCallback | null): void {
    this.callback = callback;
  }

  getCallback(): DrawableCallback | null {
    return this.callback;
  }

  invalidateSelf(): void {
    this.callback?.invalidateDrawable(this);
  }

  isStateful(): boolean {
    return false;
  }

  setState(state: readonly string[]): boolean {
    this.state = state;
    return this.onStateChange(state);
  }

  getState(): readonly string[] {
    return this.state;
  }

  protected onStateChange(_state: readonly string[]): boolean {
    return false;
  }

  setHotspot(_x: number, _y: number): void {}

  setAlpha(alpha: number): void {
    this.alpha = alpha;
    this.invalidateSelf();
  }

  getAlpha(): number {
    return this.alpha;
  }

  getIntrinsicWidth(): number {
    return -1;
  }

  getIntrinsicHeight(): number {
    return -1;
  }

  /** Draw into `canvas` within getBounds(). */
  abstract draw(canvas: Canvas): void;

  /** The shape a view with this background casts its shadow from (transparent by default). */
  getOutline(outline: Outline): void {
    const b = this.bounds;
    outline.setRect(b.left, b.top, b.right, b.bottom);
    outline.setAlpha(0);
  }

  /** Drawable.getOpacity / PixelFormat: whether the drawable is see-through. */
  getOpacity(): number {
    return -3; // PixelFormat.TRANSLUCENT
  }

  /** Drawables tinted with a single color (setTint / setTintList with one color). */
  setTint(_tint: number | null): void {}

  /** Outset of what this drawable paints beyond its bounds (borderless ripples). */
  drawingOutset(): number {
    return 0;
  }
}

export class ColorDrawable extends Drawable {
  constructor(private color = 0) {
    super();
  }

  setColor(color: number): void {
    this.color = color;
    this.invalidateSelf();
  }

  getColor(): number {
    return this.color;
  }

  override getOutline(outline: Outline): void {
    const b = this.getBounds();
    outline.setRect(b.left, b.top, b.right, b.bottom);
    outline.setAlpha((Color.alpha(this.color) / 255) * (this.alpha / 255));
  }

  draw(canvas: Canvas): void {
    const b = this.getBounds();
    if (Color.alpha(this.color) === 0) return;
    canvas.writer.fillRect(b.left, b.top, b.width(), b.height(), withAlpha(Color.toRgba(this.color), this.alpha / 255));
  }
}

export enum GradientShape { RECTANGLE = 0, OVAL = 1, LINE = 2, RING = 3 }

export class GradientDrawable extends Drawable {
  static readonly RECTANGLE = GradientShape.RECTANGLE;
  static readonly OVAL = GradientShape.OVAL;
  private shape = GradientShape.RECTANGLE;
  private color = 0;
  private radii: Radii = [0, 0, 0, 0];
  private strokeWidth = 0;
  private strokeColor = 0;

  setShape(shape: GradientShape): void {
    this.shape = shape;
  }

  setColor(color: number): void {
    this.color = color;
    this.invalidateSelf();
  }

  setCornerRadius(radius: number): void {
    this.radii = [radius, radius, radius, radius];
    this.invalidateSelf();
  }

  /** [tlx, tly, trx, try, brx, bry, blx, bly] */
  setCornerRadii(radii: number[]): void {
    this.radii = [radii[0] ?? 0, radii[2] ?? 0, radii[4] ?? 0, radii[6] ?? 0];
    this.invalidateSelf();
  }

  setStroke(width: number, color: number): void {
    this.strokeWidth = width;
    this.strokeColor = color;
    this.invalidateSelf();
  }

  getColor(): number {
    return this.color;
  }

  getCornerRadius(): number {
    return this.radii[0];
  }

  override getOutline(outline: Outline): void {
    const b = this.getBounds();
    if (this.shape === GradientShape.OVAL) outline.setOval(b.left, b.top, b.right, b.bottom);
    else outline.setRoundRectRadii(b.left, b.top, b.right, b.bottom, this.radii);
    outline.setAlpha(Color.alpha(this.color) / 255);
  }

  draw(canvas: Canvas): void {
    const b = this.getBounds();
    const w = canvas.writer;
    const radii: Radii = this.shape === GradientShape.OVAL ? oval(b) : this.radii;
    if (Color.alpha(this.color)) w.fillRRect(b.left, b.top, b.width(), b.height(), radii, Color.toRgba(this.color));
    if (this.strokeWidth > 0 && Color.alpha(this.strokeColor)) {
      const s = this.strokeWidth;
      w.strokeRRect(b.left + s / 2, b.top + s / 2, b.width() - s, b.height() - s, radii, s, Color.toRgba(this.strokeColor));
    }
  }
}

const oval = (b: RectF): Radii => {
  const r = Math.min(b.width(), b.height()) / 2;
  return [r, r, r, r];
};

/** RippleDrawable.RADIUS_AUTO */
export const RADIUS_AUTO = -1;

interface Ripple {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  maxRadius: number;
  start: number;
  released: number | null;
}

export class RippleDrawable extends Drawable implements FrameTask {
  private ripple: Ripple | null = null;
  private hotspot: { x: number; y: number } | null = null;
  private pressed = false;
  private radius = RADIUS_AUTO;
  /** corner radii the ripple is masked to (the view's outline) */
  maskRadii: Radii = [0, 0, 0, 0];

  /** `mask === null` and no content: an unbounded (borderless) ripple */
  constructor(private color: number, readonly content: Drawable | null = null, private readonly mask: Drawable | null | 'bounded' = 'bounded') {
    super();
  }

  get isBorderless(): boolean {
    return this.mask === null && this.content === null;
  }

  override getOutline(outline: Outline): void {
    if (this.content) this.content.getOutline(outline);
    else if (this.mask && this.mask !== 'bounded') this.mask.getOutline(outline);
    else super.getOutline(outline);
  }

  override setBounds(left: number, top: number, right: number, bottom: number): void {
    super.setBounds(left, top, right, bottom);
    this.content?.setBounds(left, top, right, bottom);
    if (this.mask && this.mask !== 'bounded') this.mask.setBounds(left, top, right, bottom);
  }

  setColor(color: number): void {
    this.color = color;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  override isStateful(): boolean {
    return true;
  }

  override setHotspot(x: number, y: number): void {
    this.hotspot = { x, y };
  }

  protected override onStateChange(state: readonly string[]): boolean {
    const pressed = state.includes(StateSet.pressed) && state.includes(StateSet.enabled);
    if (pressed === this.pressed) return false;
    this.pressed = pressed;
    const kernel = this.getCallback()?.drawableKernel();
    const now = kernel?.animator.animationTime ?? 0;
    if (pressed) {
      const b = this.getBounds();
      const w = b.width();
      const h = b.height();
      const x = this.hotspot?.x ?? w / 2;
      const y = this.hotspot?.y ?? h / 2;
      const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
      const max = this.radius !== RADIUS_AUTO ? this.radius : this.isBorderless ? Math.max(w, h) / 2 : far;
      this.ripple = { x, y, radius: 0, alpha: 1, maxRadius: max, start: now, released: null };
    } else if (this.ripple) {
      this.ripple.released = now;
    }
    if (kernel) {
      kernel.animator.add(this);
      kernel.requestFrame();
    }
    this.invalidateSelf();
    return true;
  }

  tick(now: number): boolean {
    const r = this.ripple;
    if (!r) return false;
    const grow = Math.min(1, (now - r.start) / 225);
    r.radius = r.maxRadius * easeOut(grow);
    let keep = true;
    if (r.released != null) {
      const fadeStart = Math.max(r.released, r.start + 120);
      const fade = Math.max(0, Math.min(1, (now - fadeStart) / 150));
      r.alpha = 1 - fade;
      if (fade >= 1) {
        this.ripple = null;
        keep = false;
      }
    }
    this.invalidateSelf();
    return keep;
  }

  get isActive(): boolean {
    return !!this.ripple && this.ripple.alpha > 0;
  }

  override drawingOutset(): number {
    if (!this.ripple || !this.isBorderless) return 0;
    return this.ripple.radius;
  }

  draw(canvas: Canvas): void {
    this.content?.draw(canvas);
    this.drawRipple(canvas.writer);
  }

  /** The ripple itself, in the drawable's bounds coordinates. */
  drawRipple(w: CommandWriter): void {
    const r = this.ripple;
    if (!r || r.alpha <= 0) return;
    const b = this.getBounds();
    const cx = b.left + r.x;
    const cy = b.top + r.y;
    w.save();
    if (!this.isBorderless) w.clipRRect(b.left, b.top, b.width(), b.height(), this.maskRadii);
    w.pathBegin().arc(cx, cy, Math.max(0.01, r.radius), 0, Math.PI * 2).closePath().fillPath(withAlpha(Color.toRgba(this.color), r.alpha));
    w.restore();
  }

  /** Bounds the ripple currently paints (for culling). */
  rippleBounds(): RectF | null {
    const r = this.ripple;
    if (!r || r.alpha <= 0) return null;
    const b = this.getBounds();
    if (!this.isBorderless) return b;
    const cx = b.left + r.x;
    const cy = b.top + r.y;
    return new RectF(cx - r.radius, cy - r.radius, cx + r.radius, cy + r.radius);
  }
}
