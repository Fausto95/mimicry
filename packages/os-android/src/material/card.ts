import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { withAlphaArgb } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { Color } from '../graphics/color';
import { RippleDrawable, StateSet } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { FrameLayout } from '../view/view-group';
import { MaterialShapeDrawable } from './shape';

/**
 * androidx.cardview.widget.CardView and
 * com.google.android.material.card.MaterialCardView: a FrameLayout on a
 * rounded, elevated surface that clips its children to its corners.
 *
 * Material 3 cards have 12 dp corners in three styles: elevated
 * (surfaceContainerLow at 1 dp), filled (surfaceContainerHighest) and
 * outlined (surface with a 1 dp outlineVariant stroke). Clickable cards
 * show the state-layer ripple above their content; checkable cards show a
 * check icon in the top-end corner when checked.
 */
export enum CardStyle {
  ELEVATED = 0,
  FILLED = 1,
  OUTLINED = 2,
}

export class CardView extends FrameLayout {
  protected readonly shape = new MaterialShapeDrawable();
  private cardElevation = 0;
  private maxCardElevation = 0;
  private useCompatPadding = false;
  private preventCornerOverlap = true;

  constructor(context: Context) {
    super(context);
    this.shape.setCornerSize(4);
    this.shape.setFillColor(ColorStateList.valueOf(context.getTheme().getColor('colorSurface')));
    this.setBackground(this.shape);
    this.setClipToOutline(true);
  }

  setRadius(radius: number): void {
    this.shape.setCornerSize(radius);
    this.invalidateOutline();
  }

  getRadius(): number {
    return this.shape.getCornerSize();
  }

  setCardBackgroundColor(color: number | ColorStateList): void {
    this.shape.setFillColor(typeof color === 'number' ? ColorStateList.valueOf(color) : color);
    this.invalidateOutline();
  }

  getCardBackgroundColor(): ColorStateList | null {
    return this.shape.getFillColor();
  }

  setCardElevation(elevation: number): void {
    this.cardElevation = elevation;
    this.setElevation(elevation);
  }

  getCardElevation(): number {
    return this.cardElevation;
  }

  setMaxCardElevation(elevation: number): void {
    this.maxCardElevation = elevation;
  }

  getMaxCardElevation(): number {
    return Math.max(this.maxCardElevation, this.cardElevation);
  }

  /** CardView.setContentPadding: padding between the card's edge and its children. */
  setContentPadding(left: number, top: number, right: number, bottom: number): void {
    this.setPadding(left, top, right, bottom);
  }

  getContentPaddingLeft(): number { return this.getPaddingLeft(); }
  getContentPaddingTop(): number { return this.getPaddingTop(); }
  getContentPaddingRight(): number { return this.getPaddingRight(); }
  getContentPaddingBottom(): number { return this.getPaddingBottom(); }

  setUseCompatPadding(use: boolean): void {
    this.useCompatPadding = use;
  }

  getUseCompatPadding(): boolean {
    return this.useCompatPadding;
  }

  setPreventCornerOverlap(prevent: boolean): void {
    this.preventCornerOverlap = prevent;
  }

  getPreventCornerOverlap(): boolean {
    return this.preventCornerOverlap;
  }
}

export class MaterialCardView extends CardView {
  private strokeWidth = 0;
  private checkable = false;
  private checked = false;
  private readonly checkedIcon: MaterialIconDrawable;
  private onCheckedChange: ((card: MaterialCardView, isChecked: boolean) => void) | null = null;
  private readonly ripple: RippleDrawable;

  constructor(context: Context, style: CardStyle = CardStyle.ELEVATED) {
    super(context);
    const theme = context.getTheme();
    this.shape.setCornerSize(12);
    const fill = style === CardStyle.FILLED ? 'colorSurfaceContainerHighest' : style === CardStyle.OUTLINED ? 'colorSurface' : 'colorSurfaceContainerLow';
    this.shape.setFillColor(ColorStateList.valueOf(theme.getColor(fill)));
    if (style === CardStyle.OUTLINED) this.setStrokeWidth(1);
    this.setCardElevation(style === CardStyle.ELEVATED ? 1 : 0);
    this.ripple = new RippleDrawable(withAlphaArgb(theme.getColor('colorOnSurface'), 0.1));
    this.checkedIcon = new MaterialIconDrawable(context, 'check_circle', 24, theme.getColor('colorPrimary'));
  }

  setStrokeWidth(width: number): void {
    this.strokeWidth = width;
    const color = this.shape.getStrokeColor() ?? ColorStateList.valueOf(this.context.getTheme().getColor('colorOutlineVariant'));
    this.shape.setStroke(width, color);
  }

  getStrokeWidth(): number {
    return this.strokeWidth;
  }

  setStrokeColor(color: number | ColorStateList): void {
    this.shape.setStroke(this.strokeWidth || 1, color);
  }

  override setOnClickListener(listener: ((view: View) => void) | null): void {
    super.setOnClickListener(listener);
    this.updateForeground();
  }

  override setClickable(clickable: boolean): void {
    super.setClickable(clickable);
    this.updateForeground?.();
  }

  private updateForeground(): void {
    if (!this.ripple) return;
    this.setForeground(this.isClickable() || this.checkable ? this.ripple : null);
    this.ripple.maskRadii = [this.getRadius(), this.getRadius(), this.getRadius(), this.getRadius()];
  }

  setCheckable(checkable: boolean): void {
    this.checkable = checkable;
    this.updateForeground();
  }

  isCheckable(): boolean {
    return this.checkable;
  }

  setChecked(checked: boolean): void {
    if (!this.checkable || this.checked === checked) return;
    this.checked = checked;
    this.refreshDrawableState();
    this.onCheckedChange?.(this, checked);
    this.invalidate();
  }

  isChecked(): boolean {
    return this.checked;
  }

  toggle(): void {
    this.setChecked(!this.checked);
  }

  setOnCheckedChangeListener(listener: ((card: MaterialCardView, isChecked: boolean) => void) | null): void {
    this.onCheckedChange = listener;
  }

  protected override drawableState(): string[] {
    const s = super.drawableState();
    if (this.checked) s.push(StateSet.checked);
    return s;
  }

  protected override onDrawForeground(canvas: Canvas): void {
    super.onDrawForeground(canvas);
    if (this.checked) {
      const size = 24;
      const x = this.getWidth() - 8 - size;
      this.checkedIcon.setBounds(x, 8, x + size, 8 + size);
      this.checkedIcon.draw(canvas);
    }
  }
}

/**
 * com.google.android.material.divider.MaterialDivider: a 1 dp line in
 * outlineVariant, optionally inset at its start and end.
 */
export class MaterialDivider extends View {
  private thickness = 1;
  private insetStart = 0;
  private insetEnd = 0;
  private color: number;

  constructor(context: Context) {
    super(context);
    this.color = context.getTheme().getColor('colorOutlineVariant');
    this.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
  }

  setDividerThickness(thickness: number): void {
    this.thickness = thickness;
    this.requestLayout();
  }

  getDividerThickness(): number {
    return this.thickness;
  }

  setDividerInsetStart(inset: number): void {
    this.insetStart = inset;
    this.invalidate();
  }

  setDividerInsetEnd(inset: number): void {
    this.insetEnd = inset;
    this.invalidate();
  }

  setDividerColor(color: number): void {
    this.color = color;
    this.invalidate();
  }

  getDividerColor(): number {
    return this.color;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const height = MeasureSpec.getMode(heightMeasureSpec) === MeasureSpec.EXACTLY ? MeasureSpec.getSize(heightMeasureSpec) : this.thickness;
    this.setMeasuredDimension(View.getDefaultSize(this.getSuggestedMinimumWidth(), widthMeasureSpec), height);
  }

  protected override onDraw(canvas: Canvas): void {
    const top = (this.getHeight() - this.thickness) / 2;
    canvas.writer.fillRect(this.insetStart, top, this.getWidth() - this.insetStart - this.insetEnd, this.thickness, Color.toRgba(this.color));
  }
}
