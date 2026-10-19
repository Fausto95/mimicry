import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { RippleDrawable, StateSet, type Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Gravity } from '../view/gravity';
import { MeasureSpec, View } from '../view/view';
import { TextView } from '../widget/text-view';
import { ImageView, ScaleType } from '../widget/image-view';
import { TruncateAt } from '../text/static-layout';
import { CORNER_FULL, MaterialBackground, MaterialShapeDrawable, disabledColors, enabledList } from './shape';

/**
 * android.widget.Button and com.google.android.material.button.MaterialButton
 * in their Material 3 styles: filled (the default), tonal, outlined, text and
 * elevated buttons, and icon buttons (standard, filled, tonal, outlined).
 *
 * A button's container is 40 dp tall with fully rounded corners inside a
 * 48 dp touch target (4 dp insets above and below, as MDC lays it out); the
 * label is LabelLarge, not all caps. Pressing shows the M3 state layer
 * (the content color at 10 %) as a ripple masked to the container; disabled
 * buttons draw their content at 38 % and container at 12 % of onSurface.
 *
 * `new Button(context)` looks like a filled MaterialButton, which is what a
 * <Button> inflates to in a Material Components app.
 */
export enum ButtonStyle {
  FILLED = 0,
  TONAL = 1,
  OUTLINED = 2,
  TEXT = 3,
  ELEVATED = 4,
  ICON = 5,
  ICON_FILLED = 6,
  ICON_TONAL = 7,
  ICON_OUTLINED = 8,
}

const INSET = 4;
const HEIGHT = 48;

interface StyleColors {
  container: string | null;
  content: string;
  stroke: string | null;
  elevation: number;
}

const STYLES: Record<ButtonStyle, StyleColors> = {
  [ButtonStyle.FILLED]: { container: 'colorPrimary', content: 'colorOnPrimary', stroke: null, elevation: 0 },
  [ButtonStyle.TONAL]: { container: 'colorSecondaryContainer', content: 'colorOnSecondaryContainer', stroke: null, elevation: 0 },
  [ButtonStyle.OUTLINED]: { container: null, content: 'colorPrimary', stroke: 'colorOutlineVariant', elevation: 0 },
  [ButtonStyle.TEXT]: { container: null, content: 'colorPrimary', stroke: null, elevation: 0 },
  [ButtonStyle.ELEVATED]: { container: 'colorSurfaceContainerLow', content: 'colorPrimary', stroke: null, elevation: 1 },
  [ButtonStyle.ICON]: { container: null, content: 'colorOnSurfaceVariant', stroke: null, elevation: 0 },
  [ButtonStyle.ICON_FILLED]: { container: 'colorPrimary', content: 'colorOnPrimary', stroke: null, elevation: 0 },
  [ButtonStyle.ICON_TONAL]: { container: 'colorSecondaryContainer', content: 'colorOnSecondaryContainer', stroke: null, elevation: 0 },
  [ButtonStyle.ICON_OUTLINED]: { container: null, content: 'colorOnSurfaceVariant', stroke: 'colorOutlineVariant', elevation: 0 },
};

export const isIconStyle = (style: ButtonStyle) => style >= ButtonStyle.ICON;

export type OnButtonCheckedListener = (button: MaterialButton, isChecked: boolean) => void;

export class Button extends TextView {
  protected readonly shape = new MaterialShapeDrawable();
  protected readonly backgroundDrawable: MaterialBackground;
  protected buttonStyle: ButtonStyle;

  constructor(context: Context, style: ButtonStyle = ButtonStyle.FILLED) {
    super(context);
    this.buttonStyle = style;
    this.shape.setCornerSize(CORNER_FULL);
    this.shape.setInsets(0, INSET, 0, INSET);
    this.backgroundDrawable = new MaterialBackground(this.shape, 0);
    this.setBackground(this.backgroundDrawable);
    this.setClickable(true);
    this.setFocusable(true);
    this.setGravity(Gravity.CENTER);
    this.setTextAppearance(TextAppearance.LabelLarge);
    this.setSingleLine(true);
    this.setEllipsize(TruncateAt.END);
    this.setMinimumHeight(HEIGHT);
    this.setMinimumWidth(48);
    this.applyStyle();
  }

  getButtonStyle(): ButtonStyle {
    return this.buttonStyle;
  }

  /** Switch between the M3 button styles. */
  setButtonStyle(style: ButtonStyle): void {
    this.buttonStyle = style;
    this.applyStyle();
  }

  protected applyStyle(): void {
    const theme = this.context.getTheme();
    const spec = STYLES[this.buttonStyle];
    const disabled = disabledColors(this.context);
    const content = theme.getColor(spec.content);
    this.setTextColor(enabledList(content, disabled.content));
    this.shape.setFillColor(spec.container ? enabledList(theme.getColor(spec.container), disabled.container) : null);
    this.shape.setStroke(spec.stroke ? 1 : 0, spec.stroke ? enabledList(theme.getColor(spec.stroke), disabled.container) : null);
    this.backgroundDrawable.setRippleContentColor(content);
    this.setElevation(spec.elevation);
    this.applyPadding();
  }

  protected applyPadding(): void {
    const text = this.buttonStyle === ButtonStyle.TEXT;
    this.setPadding(text ? 12 : 24, INSET + 6, text ? 12 : 24, INSET + 6);
  }

  /** The container's corner radius (dp; fully rounded by default). */
  setCornerRadius(radius: number): void {
    this.shape.setCornerSize(radius);
  }

  getCornerRadius(): number {
    return this.shape.getCornerSize();
  }

  setStrokeWidth(width: number): void {
    this.shape.setStroke(width, this.shape.getStrokeColor() ?? ColorStateList.valueOf(this.context.getTheme().getColor('colorOutline')));
  }

  setStrokeColor(color: ColorStateList | number | null): void {
    this.shape.setStroke(this.shape.getStrokeWidth() || 1, color);
  }

  /** The container color (backgroundTintList in MDC). */
  setBackgroundTintList(tint: ColorStateList | null): void {
    this.shape.setFillColor(tint);
  }

  setBackgroundColorTint(color: number): void {
    this.shape.setFillColor(ColorStateList.valueOf(color));
  }

  /** The ripple's color (state layer); the content color at 10 % by default. */
  setRippleColor(color: number): void {
    this.backgroundDrawable.setColor(color);
  }

  /** Mimicry: the container's visual inset inside the 48 dp touch target. */
  setInsetTop(inset: number): void {
    const b = this.shape;
    b.setInsets(0, inset, 0, INSET);
    this.invalidate();
  }

  setInsetBottom(inset: number): void {
    this.shape.setInsets(0, INSET, 0, inset);
    this.invalidate();
  }

  getShapeDrawable(): MaterialShapeDrawable {
    return this.shape;
  }
}

export class MaterialButton extends Button {
  static readonly ICON_GRAVITY_START = 0x1;
  static readonly ICON_GRAVITY_TEXT_START = 0x2;
  static readonly ICON_GRAVITY_END = 0x3;
  static readonly ICON_GRAVITY_TEXT_END = 0x4;
  static readonly ICON_GRAVITY_TOP = 0x10;
  static readonly ICON_GRAVITY_TEXT_TOP = 0x20;

  private icon: Drawable | null = null;
  private iconSize = 18;
  private iconPadding = 8;
  private iconGravity = MaterialButton.ICON_GRAVITY_TEXT_START;
  private iconTint: ColorStateList | null = null;
  private checkable = false;
  private checked = false;
  private readonly checkedListeners: OnButtonCheckedListener[] = [];

  constructor(context: Context, style: ButtonStyle = ButtonStyle.FILLED) {
    super(context, style);
    if (isIconStyle(style)) this.iconSize = 24;
  }

  protected override applyStyle(): void {
    super.applyStyle();
    if (isIconStyle(this.buttonStyle)) {
      this.iconSize = 24;
      this.shape.setInsets(INSET, INSET, INSET, INSET);
      this.setMinimumWidth(HEIGHT);
      this.updateCheckedColors();
    }
    this.applyIconTint();
  }

  protected override applyPadding(): void {
    if (isIconStyle(this.buttonStyle)) {
      this.setPadding(12, 12, 12, 12);
      return;
    }
    const text = this.buttonStyle === ButtonStyle.TEXT;
    const withIcon = this.icon != null && (this.iconGravity === MaterialButton.ICON_GRAVITY_START || this.iconGravity === MaterialButton.ICON_GRAVITY_TEXT_START);
    const start = text ? 12 : withIcon ? 16 : 24;
    const end = text ? (this.icon ? 16 : 12) : 24;
    this.setPadding(start, INSET + 6, end, INSET + 6);
  }

  // ── icon ────────────────────────────────────────────────────────────

  /** A drawable, or a Material Symbols icon name. */
  setIcon(icon: Drawable | string | null): void {
    this.icon?.setCallback(null);
    this.icon = typeof icon === 'string' ? new MaterialIconDrawable(this.context, icon, this.iconSize) : icon;
    this.icon?.setCallback(this);
    this.applyIconTint();
    this.applyPadding();
    this.requestLayout();
    this.invalidate();
  }

  setIconResource(name: string): void {
    this.setIcon(name);
  }

  getIcon(): Drawable | null {
    return this.icon;
  }

  setIconSize(size: number): void {
    this.iconSize = size;
    if (this.icon instanceof MaterialIconDrawable) this.icon.setSize(size);
    this.requestLayout();
  }

  getIconSize(): number {
    return this.iconSize;
  }

  setIconPadding(padding: number): void {
    this.iconPadding = padding;
    this.requestLayout();
  }

  setIconGravity(gravity: number): void {
    this.iconGravity = gravity;
    this.applyPadding();
    this.requestLayout();
  }

  setIconTint(tint: ColorStateList | null): void {
    this.iconTint = tint;
    this.applyIconTint();
  }

  private applyIconTint(): void {
    if (!this.icon) return;
    const list = this.iconTint ?? this.getTextColors();
    this.icon.setTint(list.getColorForState(this.getDrawableState(), list.getDefaultColor()));
    this.invalidate();
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    this.applyIconTint();
  }

  private iconSpace(): number {
    if (!this.icon || isIconStyle(this.buttonStyle)) return 0;
    return this.iconSize + (this.length() ? this.iconPadding : 0);
  }

  override getCompoundPaddingLeft(): number {
    const g = this.iconGravity;
    const start = g === MaterialButton.ICON_GRAVITY_START || g === MaterialButton.ICON_GRAVITY_TEXT_START;
    return super.getCompoundPaddingLeft() + (start ? this.iconSpace() : 0);
  }

  override getCompoundPaddingRight(): number {
    const g = this.iconGravity;
    const end = g === MaterialButton.ICON_GRAVITY_END || g === MaterialButton.ICON_GRAVITY_TEXT_END;
    return super.getCompoundPaddingRight() + (end ? this.iconSpace() : 0);
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    if (isIconStyle(this.buttonStyle) && !this.length()) {
      this.setMeasuredDimension(View.resolveSize(HEIGHT, widthMeasureSpec), View.resolveSize(HEIGHT, heightMeasureSpec));
      return;
    }
    super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    void MeasureSpec;
  }

  protected override onDraw(canvas: Canvas): void {
    super.onDraw(canvas);
    const icon = this.icon;
    if (!icon) return;
    const w = this.getWidth();
    const h = this.getHeight();
    const size = this.iconSize;
    let x: number;
    if (isIconStyle(this.buttonStyle) || !this.length()) {
      x = (w - size) / 2;
    } else {
      const g = this.iconGravity;
      const layout = this.getLayout();
      const textWidth = layout ? Math.max(0, ...Array.from({ length: layout.getLineCount() }, (_, i) => layout.getLineWidth(i))) : 0;
      const textArea = w - this.getCompoundPaddingLeft() - this.getCompoundPaddingRight();
      const textLeft = this.getCompoundPaddingLeft() + Math.max(0, (textArea - textWidth) / 2);
      if (g === MaterialButton.ICON_GRAVITY_START) x = this.getPaddingLeft();
      else if (g === MaterialButton.ICON_GRAVITY_TEXT_START) x = textLeft - this.iconPadding - size;
      else if (g === MaterialButton.ICON_GRAVITY_END) x = w - this.getPaddingRight() - size;
      else x = textLeft + textWidth + this.iconPadding;
    }
    icon.setBounds(x, (h - size) / 2, x + size, (h + size) / 2);
    icon.draw(canvas);
  }

  override invalidateDrawable(who: Drawable): void {
    if (who === this.icon) this.invalidate();
    else super.invalidateDrawable(who);
  }

  // ── toggle buttons ──────────────────────────────────────────────────

  setCheckable(checkable: boolean): void {
    this.checkable = checkable;
    this.updateCheckedColors();
  }

  isCheckable(): boolean {
    return this.checkable;
  }

  isChecked(): boolean {
    return this.checked;
  }

  setChecked(checked: boolean): void {
    if (!this.checkable || this.checked === checked) return;
    this.checked = checked;
    this.refreshDrawableState();
    this.updateCheckedColors();
    for (const l of this.checkedListeners.slice()) l(this, checked);
  }

  toggle(): void {
    this.setChecked(!this.checked);
  }

  addOnCheckedChangeListener(listener: OnButtonCheckedListener): void {
    this.checkedListeners.push(listener);
  }

  removeOnCheckedChangeListener(listener: OnButtonCheckedListener): void {
    const at = this.checkedListeners.indexOf(listener);
    if (at >= 0) this.checkedListeners.splice(at, 1);
  }

  override performClick(): boolean {
    if (this.checkable) this.toggle();
    return super.performClick();
  }

  protected override drawableState(): string[] {
    const s = super.drawableState();
    if (this.checkable) s.push(StateSet.checkable);
    if (this.checked) s.push(StateSet.checked);
    return s;
  }

  /** Selected toggle and icon buttons fill with their selected container (M3 toggle colors). */
  private updateCheckedColors(): void {
    if (!this.checkable) return;
    const theme = this.context.getTheme();
    const disabled = disabledColors(this.context);
    const on = (attr: string) => theme.getColor(attr);
    const filled = this.buttonStyle === ButtonStyle.ICON_FILLED || this.buttonStyle === ButtonStyle.FILLED;
    const container = filled ? [on('colorPrimary'), on('colorSurfaceContainerHighest')] : [on('colorSecondaryContainer'), 0];
    const content = filled ? [on('colorOnPrimary'), on('colorPrimary')] : this.buttonStyle === ButtonStyle.ICON || this.buttonStyle === ButtonStyle.ICON_OUTLINED ? [on('colorPrimary'), on('colorOnSurfaceVariant')] : [on('colorOnSecondaryContainer'), on('colorPrimary')];
    const list = (checked: number, unchecked: number, off: number) => new ColorStateList([[`-${StateSet.enabled}`], [StateSet.checked], []], [off, checked, unchecked]);
    this.shape.setFillColor(list(container[0]!, container[1]!, disabled.container));
    this.setTextColor(list(content[0]!, content[1]!, disabled.content));
    this.backgroundDrawable.setRippleContentColor(this.checked ? content[0]! : content[1]!);
    this.applyIconTint();
  }
}

/**
 * android.widget.ImageButton: an ImageView that is a button. In a Material
 * theme it has a borderless ripple (selectableItemBackgroundBorderless) and
 * centers its image.
 */
export class ImageButton extends ImageView {
  constructor(context: Context) {
    super(context);
    this.setClickable(true);
    this.setFocusable(true);
    this.setScaleType(ScaleType.CENTER);
    const ripple = new RippleDrawable(withAlphaArgb(context.getTheme().getColor('colorOnSurface'), 0.1), null, null);
    ripple.setRadius(20);
    this.setBackground(ripple);
    this.setMinimumWidth(48);
    this.setMinimumHeight(48);
  }
}
