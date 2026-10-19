import type { Radii } from '@mimicry/protocol';
import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { withAlphaArgb } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { Color } from '../graphics/color';
import { Drawable, RippleDrawable, StateSet } from '../graphics/drawable';
import type { Outline } from '../view/outline';

/**
 * com.google.android.material.shape.MaterialShapeDrawable: the container
 * of every Material component — a rounded rectangle (or pill) filled and
 * stroked with state-dependent colors, inset inside its bounds (buttons and
 * chips are drawn smaller than their 48 dp touch target).
 *
 * Plus the M3 state-layer ripple every component wraps it in.
 */
export const CORNER_FULL = -1;

export class MaterialShapeDrawable extends Drawable {
  private fill: ColorStateList | null = null;
  private stroke: ColorStateList | null = null;
  private strokeWidth = 0;
  /** tl, tr, br, bl; CORNER_FULL for half the shorter side */
  private corners: [number, number, number, number] = [0, 0, 0, 0];
  private insets = { left: 0, top: 0, right: 0, bottom: 0 };

  static withCorner(corner: number, fill: ColorStateList | number | null = null): MaterialShapeDrawable {
    const d = new MaterialShapeDrawable();
    d.setCornerSize(corner);
    if (fill != null) d.setFillColor(typeof fill === 'number' ? ColorStateList.valueOf(fill) : fill);
    return d;
  }

  setFillColor(fill: ColorStateList | null): void {
    this.fill = fill;
    this.invalidateSelf();
  }

  getFillColor(): ColorStateList | null {
    return this.fill;
  }

  setStroke(width: number, color: ColorStateList | number | null): void {
    this.strokeWidth = width;
    this.stroke = color == null ? null : typeof color === 'number' ? ColorStateList.valueOf(color) : color;
    this.invalidateSelf();
  }

  getStrokeWidth(): number {
    return this.strokeWidth;
  }

  getStrokeColor(): ColorStateList | null {
    return this.stroke;
  }

  setCornerSize(size: number): void {
    this.corners = [size, size, size, size];
    this.invalidateSelf();
  }

  setCornerSizes(tl: number, tr: number, br: number, bl: number): void {
    this.corners = [tl, tr, br, bl];
    this.invalidateSelf();
  }

  getCornerSize(): number {
    return this.corners[0];
  }

  /** The visible shape sits this far inside the bounds (touch-target insets). */
  setInsets(left: number, top: number, right: number, bottom: number): void {
    this.insets = { left, top, right, bottom };
    this.invalidateSelf();
  }

  /** The shape's rectangle inside the bounds. */
  shapeRect(): { x: number; y: number; w: number; h: number } {
    const b = this.getBounds();
    const i = this.insets;
    return { x: b.left + i.left, y: b.top + i.top, w: Math.max(0, b.width() - i.left - i.right), h: Math.max(0, b.height() - i.top - i.bottom) };
  }

  /** Corner radii of the shape at its current size. */
  radii(): Radii {
    const r = this.shapeRect();
    const half = Math.min(r.w, r.h) / 2;
    return this.corners.map((c) => (c === CORNER_FULL ? half : Math.min(c, half))) as unknown as Radii;
  }

  override isStateful(): boolean {
    return !!(this.fill?.isStateful() || this.stroke?.isStateful());
  }

  protected override onStateChange(): boolean {
    this.invalidateSelf();
    return true;
  }

  private colorOf(list: ColorStateList | null): number {
    if (!list) return 0;
    return list.getColorForState(this.state, list.getDefaultColor());
  }

  override getOutline(outline: Outline): void {
    const r = this.shapeRect();
    outline.setRoundRectRadii(r.x, r.y, r.x + r.w, r.y + r.h, this.radii());
    const fill = this.colorOf(this.fill);
    outline.setAlpha((Color.alpha(fill) / 255) * (this.alpha / 255));
  }

  draw(canvas: Canvas): void {
    const r = this.shapeRect();
    if (r.w <= 0 || r.h <= 0) return;
    const radii = this.radii();
    const w = canvas.writer;
    const fade = this.alpha / 255;
    const fill = this.colorOf(this.fill);
    if (Color.alpha(fill)) w.fillRRect(r.x, r.y, r.w, r.h, radii, Color.toRgba(withAlphaArgb(fill, fade)));
    const stroke = this.colorOf(this.stroke);
    if (this.strokeWidth > 0 && Color.alpha(stroke)) {
      const s = this.strokeWidth;
      const inner = radii.map((v) => Math.max(0, v - s / 2)) as unknown as Radii;
      w.strokeRRect(r.x + s / 2, r.y + s / 2, r.w - s, r.h - s, inner, s, Color.toRgba(withAlphaArgb(stroke, fade)));
    }
  }
}

/** M3 state-layer opacities. */
export const StateLayer = {
  pressed: 0.1,
  focused: 0.1,
  hovered: 0.08,
  dragged: 0.16,
} as const;

/**
 * A component background: the shape under an M3 ripple whose color is the
 * content color at the pressed state-layer opacity, masked to the shape.
 */
export class MaterialBackground extends RippleDrawable {
  constructor(readonly shape: MaterialShapeDrawable, contentColor: number) {
    super(withAlphaArgb(contentColor, StateLayer.pressed), shape);
  }

  setRippleContentColor(contentColor: number): void {
    this.setColor(withAlphaArgb(contentColor, StateLayer.pressed));
  }

  override draw(canvas: Canvas): void {
    this.shape.draw(canvas);
    const r = this.shape.shapeRect();
    this.maskRadii = this.shape.radii();
    const w = canvas.writer;
    w.save();
    w.clipRRect(r.x, r.y, r.w, r.h, this.maskRadii);
    this.drawRipple(w);
    w.restore();
  }

  override setState(state: readonly string[]): boolean {
    this.shape.setState(state);
    return super.setState(state);
  }
}

/** Disabled content / container colors (onSurface at 38% / 12%). */
export function disabledColors(context: Context): { content: number; container: number } {
  const onSurface = context.getTheme().getColor('colorOnSurface');
  return { content: withAlphaArgb(onSurface, 0.38), container: withAlphaArgb(onSurface, 0.12) };
}

/** A ColorStateList with a disabled color and an enabled one. */
export function enabledList(enabled: number, disabled: number): ColorStateList {
  return new ColorStateList([[`-${StateSet.enabled}`], []], [disabled, enabled]);
}

/** A ColorStateList with disabled, checked and default colors. */
export function checkedList(checked: number, unchecked: number, disabled: number): ColorStateList {
  return new ColorStateList([[`-${StateSet.enabled}`], [StateSet.checked], []], [disabled, checked, unchecked]);
}
