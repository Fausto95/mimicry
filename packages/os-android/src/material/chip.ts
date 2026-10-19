import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { TextAppearance } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { StateSet, type Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Gravity } from '../view/gravity';
import { MotionEvent } from '../view/motion-event';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { ViewGroup, marginsOf, measureChildWithMargins } from '../view/view-group';
import { CompoundButton } from '../widget/controls';
import { MaterialBackground, MaterialShapeDrawable, disabledColors } from './shape';

/**
 * com.google.android.material.chip.Chip and ChipGroup, Material 3: assist,
 * filter, input and suggestion chips — 32 dp tall with 8 dp corners inside
 * a 48 dp touch target, LabelLarge text, a 1 dp outlineVariant outline,
 * optional 18 dp leading (chip) icon and trailing close icon. A checked
 * filter chip fills with secondaryContainer and shows a check icon.
 *
 * ChipGroup flows chips into rows with 8 dp spacing and can enforce single
 * selection.
 */
export enum ChipStyle {
  ASSIST = 0,
  FILTER = 1,
  INPUT = 2,
  SUGGESTION = 3,
}

const CONTAINER = 32;
const TARGET = 48;
const ICON = 18;

export class Chip extends CompoundButton {
  override getAccessibilityClassName(): string {
    return 'android.widget.Button';
  }

  private readonly shape = new MaterialShapeDrawable();
  private readonly backgroundDrawable: MaterialBackground;
  private chipIcon: Drawable | null = null;
  private checkedIcon: Drawable;
  private closeIcon: Drawable;
  private closeIconVisible = false;
  private checkedIconVisible = true;
  private chipIconVisible = true;
  private checkable = false;
  private closeListener: ((chip: Chip) => void) | null = null;
  private closePressed = false;

  constructor(context: Context, readonly style: ChipStyle = ChipStyle.ASSIST) {
    super(context);
    const theme = context.getTheme();
    this.shape.setCornerSize(8);
    this.shape.setInsets(0, (TARGET - CONTAINER) / 2, 0, (TARGET - CONTAINER) / 2);
    this.backgroundDrawable = new MaterialBackground(this.shape, theme.getColor('colorOnSurfaceVariant'));
    this.setBackground(this.backgroundDrawable);
    this.setTextAppearance(TextAppearance.LabelLarge);
    this.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
    this.setSingleLine(true);
    this.setMinimumHeight(TARGET);
    this.setFocusable(true);
    this.checkedIcon = new MaterialIconDrawable(context, 'check', ICON);
    this.closeIcon = new MaterialIconDrawable(context, 'close', ICON);
    if (style === ChipStyle.FILTER) this.checkable = true;
    if (style === ChipStyle.INPUT) this.closeIconVisible = true;
    this.applyColors();
  }

  private applyColors(): void {
    const theme = this.context.getTheme();
    const disabled = disabledColors(this.context);
    const outline = theme.getColor('colorOutlineVariant');
    const selected = theme.getColor('colorSecondaryContainer');
    const content = this.style === ChipStyle.ASSIST ? theme.getColor('colorOnSurface') : theme.getColor('colorOnSurfaceVariant');
    const onSelected = theme.getColor('colorOnSecondaryContainer');
    this.shape.setFillColor(new ColorStateList([[StateSet.checked], []], [selected, 0]));
    this.shape.setStroke(1, new ColorStateList([[`-${StateSet.enabled}`], [StateSet.checked], []], [disabled.container, 0, outline]));
    this.setTextColor(new ColorStateList([[`-${StateSet.enabled}`], [StateSet.checked], []], [disabled.content, onSelected, content]));
    const iconTint = new ColorStateList([[`-${StateSet.enabled}`], [StateSet.checked], []], [disabled.content, onSelected, this.style === ChipStyle.ASSIST ? theme.getColor('colorPrimary') : content]);
    this.iconTintList = iconTint;
    this.tintIcons();
  }

  private iconTintList: ColorStateList | null = null;

  private tintIcons(): void {
    const list = this.iconTintList;
    if (!list) return;
    const color = list.getColorForState(this.getDrawableState(), list.getDefaultColor());
    this.chipIcon?.setTint(color);
    this.checkedIcon?.setTint(color);
    this.closeIcon?.setTint(color);
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    this.tintIcons();
    this.backgroundDrawable?.setRippleContentColor(this.getCurrentTextColor());
  }

  // ── chip attributes ─────────────────────────────────────────────────

  setCheckable(checkable: boolean): void {
    this.checkable = checkable;
    if (!checkable && this.isChecked()) this.setChecked(false, false);
  }

  isCheckable(): boolean {
    return this.checkable;
  }

  override setChecked(checked: boolean, animate = true): void {
    if (checked && !this.checkable) return;
    super.setChecked(checked, animate);
    this.requestLayout();
  }

  override toggle(): void {
    if (this.checkable) super.toggle();
  }

  /** A leading icon: a drawable or a Material Symbols name. */
  setChipIcon(icon: Drawable | string | null): void {
    this.chipIcon = typeof icon === 'string' ? new MaterialIconDrawable(this.context, icon, ICON) : icon;
    this.tintIcons();
    this.requestLayout();
  }

  getChipIcon(): Drawable | null {
    return this.chipIcon;
  }

  setChipIconVisible(visible: boolean): void {
    this.chipIconVisible = visible;
    this.requestLayout();
  }

  setCheckedIconVisible(visible: boolean): void {
    this.checkedIconVisible = visible;
    this.requestLayout();
  }

  setCloseIconVisible(visible: boolean): void {
    this.closeIconVisible = visible;
    this.requestLayout();
  }

  isCloseIconVisible(): boolean {
    return this.closeIconVisible;
  }

  setOnCloseIconClickListener(listener: ((chip: Chip) => void) | null): void {
    this.closeListener = listener;
  }

  setChipBackgroundColor(color: ColorStateList | number): void {
    this.shape.setFillColor(typeof color === 'number' ? ColorStateList.valueOf(color) : color);
  }

  setChipStrokeWidth(width: number): void {
    this.shape.setStroke(width, this.shape.getStrokeColor());
  }

  setChipCornerRadius(radius: number): void {
    this.shape.setCornerSize(radius);
  }

  /** The leading icon shown now: the check while checked, else the chip icon. */
  private leadingIcon(): Drawable | null {
    if (this.isChecked() && this.checkable && this.checkedIconVisible) return this.checkedIcon;
    return this.chipIconVisible ? this.chipIcon : null;
  }

  override getCompoundPaddingLeft(): number {
    return this.getPaddingLeft() + (this.leadingIcon() ? 8 + ICON + 8 : 16);
  }

  override getCompoundPaddingRight(): number {
    return this.getPaddingRight() + (this.closeIconVisible ? 8 + ICON + 8 : 16);
  }

  private closeIconRect(): { x: number; y: number; w: number; h: number } {
    const x = this.getWidth() - this.getPaddingRight() - 8 - ICON;
    return { x, y: (this.getHeight() - ICON) / 2, w: ICON, h: ICON };
  }

  protected override onDraw(canvas: Canvas): void {
    super.onDraw(canvas);
    const icon = this.leadingIcon();
    const cy = this.getHeight() / 2;
    if (icon) {
      const x = this.getPaddingLeft() + 8;
      icon.setBounds(x, cy - ICON / 2, x + ICON, cy + ICON / 2);
      icon.draw(canvas);
    }
    if (this.closeIconVisible) {
      const r = this.closeIconRect();
      this.closeIcon.setBounds(r.x, r.y, r.x + r.w, r.y + r.h);
      this.closeIcon.draw(canvas);
    }
  }

  override onTouchEvent(event: MotionEvent): boolean {
    if (this.closeIconVisible && this.isEnabled()) {
      const r = this.closeIconRect();
      const x = event.getX();
      const y = event.getY();
      const inside = x >= r.x - 12 && x <= r.x + r.w + 12 && y >= r.y - 12 && y <= r.y + r.h + 12;
      switch (event.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          if (inside) {
            this.closePressed = true;
            return true;
          }
          break;
        case MotionEvent.ACTION_MOVE:
          if (this.closePressed) return true;
          break;
        case MotionEvent.ACTION_UP:
          if (this.closePressed) {
            this.closePressed = false;
            if (inside) this.performCloseIconClick();
            return true;
          }
          break;
        case MotionEvent.ACTION_CANCEL:
          this.closePressed = false;
          break;
      }
    }
    return super.onTouchEvent(event);
  }

  performCloseIconClick(): boolean {
    if (!this.closeListener) return false;
    this.closeListener(this);
    return true;
  }
}

export type OnCheckedStateChangeListener = (group: ChipGroup, checkedIds: number[]) => void;

/**
 * com.google.android.material.chip.ChipGroup: chips flowed into rows (or a
 * single row), with optional single selection.
 */
export class ChipGroup extends ViewGroup {
  private spacingHorizontal = 8;
  private spacingVertical = 8;
  private singleLine = false;
  private singleSelection = false;
  private selectionRequired = false;
  private listener: OnCheckedStateChangeListener | null = null;
  private protect = false;

  setChipSpacing(spacing: number): void {
    this.spacingHorizontal = this.spacingVertical = spacing;
    this.requestLayout();
  }

  setChipSpacingHorizontal(spacing: number): void {
    this.spacingHorizontal = spacing;
    this.requestLayout();
  }

  setChipSpacingVertical(spacing: number): void {
    this.spacingVertical = spacing;
    this.requestLayout();
  }

  setSingleLine(singleLine: boolean): void {
    this.singleLine = singleLine;
    this.requestLayout();
  }

  setSingleSelection(single: boolean): void {
    this.singleSelection = single;
    if (single) this.clearCheckExcept(this.getCheckedChipIds()[0] ?? View.NO_ID);
  }

  isSingleSelection(): boolean {
    return this.singleSelection;
  }

  setSelectionRequired(required: boolean): void {
    this.selectionRequired = required;
  }

  setOnCheckedStateChangeListener(listener: OnCheckedStateChangeListener | null): void {
    this.listener = listener;
  }

  override addView(child: View, index = -1, params?: LayoutParams): void {
    if (child instanceof Chip) {
      if (child.getId() === View.NO_ID) child.setId(View.generateViewId());
      child.setOnCheckedChangeWidgetListener((button, checked) => this.chipChecked(button as Chip, checked));
    }
    super.addView(child, index, params ?? new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
  }

  private chipChecked(chip: Chip, checked: boolean): void {
    if (this.protect) return;
    if (!checked && this.selectionRequired && !this.getCheckedChipIds().length) {
      this.protect = true;
      chip.setChecked(true);
      this.protect = false;
      return;
    }
    if (checked && this.singleSelection) this.clearCheckExcept(chip.getId());
    this.listener?.(this, this.getCheckedChipIds());
  }

  private clearCheckExcept(id: number): void {
    this.protect = true;
    for (const child of this.childViews) if (child instanceof Chip && child.getId() !== id && child.isChecked()) child.setChecked(false);
    this.protect = false;
  }

  check(id: number): void {
    const chip = this.findViewById(id);
    if (chip instanceof Chip) chip.setChecked(true);
  }

  clearCheck(): void {
    this.protect = true;
    for (const child of this.childViews) if (child instanceof Chip) child.setChecked(false);
    this.protect = false;
    this.listener?.(this, []);
  }

  getCheckedChipId(): number {
    return this.singleSelection ? this.getCheckedChipIds()[0] ?? View.NO_ID : View.NO_ID;
  }

  getCheckedChipIds(): number[] {
    return this.childViews.filter((c): c is Chip => c instanceof Chip && c.isChecked()).map((c) => c.getId());
  }

  private rows: Array<{ views: View[]; height: number }> = [];

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const widthMode = MeasureSpec.getMode(widthMeasureSpec);
    const maxWidth = widthMode === MeasureSpec.UNSPECIFIED || this.singleLine ? Infinity : MeasureSpec.getSize(widthMeasureSpec) - this.getPaddingLeft() - this.getPaddingRight();
    this.rows = [];
    let row: { views: View[]; height: number; width: number } = { views: [], height: 0, width: 0 };
    let widest = 0;
    for (const child of this.childViews) {
      if (child.getVisibility() === View.GONE) continue;
      measureChildWithMargins(this, child, MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), 0, heightMeasureSpec, 0);
      const m = marginsOf(child.getLayoutParams());
      const w = child.getMeasuredWidth() + m.left + m.right;
      const h = child.getMeasuredHeight() + m.top + m.bottom;
      const needed = row.views.length ? row.width + this.spacingHorizontal + w : w;
      if (row.views.length && needed > maxWidth) {
        this.rows.push(row);
        widest = Math.max(widest, row.width);
        row = { views: [], height: 0, width: 0 };
      }
      row.width = row.views.length ? row.width + this.spacingHorizontal + w : w;
      row.height = Math.max(row.height, h);
      row.views.push(child);
    }
    if (row.views.length) {
      this.rows.push(row);
      widest = Math.max(widest, row.width);
    }
    // Chips have 8 dp touch insets above and below, so rows overlap by them like in MDC.
    const height = this.rows.reduce((sum, r, i) => sum + r.height + (i ? this.spacingVertical - 16 : 0), 0);
    this.setMeasuredDimension(
      View.resolveSize(widest + this.getPaddingLeft() + this.getPaddingRight(), widthMeasureSpec),
      View.resolveSize(height + this.getPaddingTop() + this.getPaddingBottom(), heightMeasureSpec),
    );
  }

  protected override onLayout(): void {
    let y = this.getPaddingTop();
    this.rows.forEach((row, i) => {
      if (i) y += this.spacingVertical - 16;
      let x = this.getPaddingLeft();
      for (const child of row.views) {
        const m = marginsOf(child.getLayoutParams());
        x += m.left;
        child.layout(x, y + m.top, x + child.getMeasuredWidth(), y + m.top + child.getMeasuredHeight());
        x += child.getMeasuredWidth() + m.right + this.spacingHorizontal;
      }
      y += row.height;
    });
  }
}
