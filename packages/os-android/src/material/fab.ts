import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import type { Canvas } from '../graphics/canvas';
import type { Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { ValueAnimator } from '../animation/value-animator';
import { FastOutSlowInInterpolator } from '../animation/interpolators';
import { View } from '../view/view';
import { ImageView, ScaleType } from '../widget/image-view';
import { ButtonStyle, MaterialButton } from './button';
import { MaterialBackground, MaterialShapeDrawable, disabledColors, enabledList } from './shape';

/**
 * com.google.android.material.floatingactionbutton: FloatingActionButton
 * and ExtendedFloatingActionButton, Material 3. A FAB is a 56 dp container
 * (40 dp small, 96 dp large) with 16 dp corners (12 / 28), primaryContainer
 * with an onPrimaryContainer 24 dp icon (36 dp large), at elevation 6 dp.
 * show()/hide() scale and fade it; the extended FAB adds a label and can
 * shrink() to the icon and extend() back, animating its width.
 */
export enum FabSize {
  NORMAL = 0,
  MINI = 1,
  AUTO = -1,
  LARGE = 2,
}

const SIZES: Record<number, { size: number; corner: number; icon: number }> = {
  [FabSize.NORMAL]: { size: 56, corner: 16, icon: 24 },
  [FabSize.MINI]: { size: 40, corner: 12, icon: 24 },
  [FabSize.LARGE]: { size: 96, corner: 28, icon: 36 },
};

export enum FabColors {
  PRIMARY = 0,
  SURFACE = 1,
  SECONDARY = 2,
  TERTIARY = 3,
}

const PALETTES: Record<FabColors, [string, string]> = {
  [FabColors.PRIMARY]: ['colorPrimaryContainer', 'colorOnPrimaryContainer'],
  [FabColors.SURFACE]: ['colorSurfaceContainerHigh', 'colorPrimary'],
  [FabColors.SECONDARY]: ['colorSecondaryContainer', 'colorOnSecondaryContainer'],
  [FabColors.TERTIARY]: ['colorTertiaryContainer', 'colorOnTertiaryContainer'],
};

export class FloatingActionButton extends ImageView {
  static readonly SIZE_NORMAL = FabSize.NORMAL;
  static readonly SIZE_MINI = FabSize.MINI;
  static readonly SIZE_AUTO = FabSize.AUTO;
  static readonly SIZE_LARGE = FabSize.LARGE;

  private readonly shape = new MaterialShapeDrawable();
  private readonly backgroundDrawable: MaterialBackground;
  private size: FabSize = FabSize.NORMAL;
  private contentColor = 0;
  private showing: ValueAnimator | null = null;

  constructor(context: Context, colors: FabColors = FabColors.PRIMARY) {
    super(context);
    this.backgroundDrawable = new MaterialBackground(this.shape, 0);
    this.setBackground(this.backgroundDrawable);
    this.setScaleType(ScaleType.CENTER);
    this.setClickable(true);
    this.setFocusable(true);
    this.setColors(colors);
    this.setElevation(6);
    this.applySize();
  }

  setColors(colors: FabColors): void {
    const theme = this.context.getTheme();
    const [container, content] = PALETTES[colors];
    const disabled = disabledColors(this.context);
    this.shape.setFillColor(enabledList(theme.getColor(container), disabled.container));
    this.contentColor = theme.getColor(content);
    this.backgroundDrawable.setRippleContentColor(this.contentColor);
    this.setImageTintList(enabledList(this.contentColor, disabled.content));
  }

  setSize(size: FabSize): void {
    this.size = size === FabSize.AUTO ? FabSize.NORMAL : size;
    this.applySize();
  }

  getSize(): FabSize {
    return this.size;
  }

  private applySize(): void {
    const spec = SIZES[this.size]!;
    this.shape.setCornerSize(spec.corner);
    const d = this.getDrawable();
    if (d instanceof MaterialIconDrawable) d.setSize(spec.icon);
    this.requestLayout();
  }

  /** A drawable, or a Material Symbols icon name. */
  override setImageResource(resource: string | Drawable): void {
    if (typeof resource === 'string' && /^[a-z0-9_]+$/.test(resource)) {
      this.setImageDrawable(new MaterialIconDrawable(this.context, resource, SIZES[this.size]!.icon));
    } else super.setImageResource(resource);
  }

  setBackgroundTintList(tint: ColorStateList | null): void {
    this.shape.setFillColor(tint);
  }

  setRippleColor(color: number): void {
    this.backgroundDrawable.setColor(color);
  }

  getCustomSize(): number {
    return SIZES[this.size]!.size;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const size = SIZES[this.size]!.size;
    this.setMeasuredDimension(View.resolveSize(size, widthMeasureSpec), View.resolveSize(size, heightMeasureSpec));
  }

  isOrWillBeShown(): boolean {
    return this.getVisibility() === View.VISIBLE;
  }

  /** Scale and fade in (FloatingActionButton.show). */
  show(): void {
    this.showing?.cancel();
    if (this.getVisibility() !== View.VISIBLE) {
      this.setScaleX(0);
      this.setScaleY(0);
      this.setAlpha(0);
    }
    this.setVisibility(View.VISIBLE);
    this.showing = this.animateTo(1, 1, () => {});
  }

  /** Scale and fade out, then GONE (FloatingActionButton.hide). */
  hide(): void {
    this.showing?.cancel();
    this.showing = this.animateTo(0, 0, () => this.setVisibility(View.GONE));
  }

  private animateTo(scale: number, alpha: number, end: () => void): ValueAnimator {
    const fromScale = this.getScaleX();
    const fromAlpha = this.getAlpha();
    const anim = ValueAnimator.ofFloat(0, 1);
    anim.setKernel(this.context.kernel);
    anim.setDuration(scale > 0 ? 200 : 150);
    anim.setInterpolator(new FastOutSlowInInterpolator());
    anim.addUpdateListener((a) => {
      const f = a.getAnimatedValue() as number;
      const s = fromScale + (scale - fromScale) * f;
      this.setScaleX(s);
      this.setScaleY(s);
      this.setAlpha(fromAlpha + (alpha - fromAlpha) * f);
    });
    let canceled = false;
    anim.addListener({ onAnimationCancel: () => (canceled = true), onAnimationEnd: () => !canceled && end() });
    anim.start();
    return anim;
  }
}

export class ExtendedFloatingActionButton extends MaterialButton {
  private extended = true;
  /** 0 = extended, 1 = shrunk to the icon */
  private collapse = 0;
  private sizeAnimator: ValueAnimator | null = null;

  constructor(context: Context, colors: FabColors = FabColors.PRIMARY) {
    super(context, ButtonStyle.FILLED);
    const theme = context.getTheme();
    const [container, content] = PALETTES[colors];
    const disabled = disabledColors(context);
    this.getShapeDrawable().setFillColor(enabledList(theme.getColor(container), disabled.container));
    this.getShapeDrawable().setInsets(0, 0, 0, 0);
    this.getShapeDrawable().setCornerSize(16);
    this.setTextColor(enabledList(theme.getColor(content), disabled.content));
    this.setRippleColor(((theme.getColor(content) & 0x00ffffff) | (26 << 24)) | 0);
    this.setIconSize(24);
    this.setIconPadding(12);
    this.setMinimumHeight(56);
    this.setMinimumWidth(80);
    this.setElevation(6);
  }

  protected override applyPadding(): void {
    this.setPadding(16, 0, 20, 0);
  }

  isExtended(): boolean {
    return this.extended;
  }

  /** Collapse to the icon, animating the width (250 ms). */
  shrink(): void {
    if (!this.extended) return;
    this.extended = false;
    this.animateCollapse(1);
  }

  extend(): void {
    if (this.extended) return;
    this.extended = true;
    this.animateCollapse(0);
  }

  private animateCollapse(to: number): void {
    this.sizeAnimator?.cancel();
    const from = this.collapse;
    const anim = ValueAnimator.ofFloat(from, to);
    anim.setKernel(this.context.kernel);
    anim.setDuration(250);
    anim.setInterpolator(new FastOutSlowInInterpolator());
    anim.addUpdateListener((a) => {
      this.collapse = a.getAnimatedValue() as number;
      this.requestLayout();
      this.invalidate();
    });
    this.sizeAnimator = anim;
    anim.start();
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    if (this.collapse > 0) {
      const full = this.getMeasuredWidth();
      this.setMeasuredDimension(full + (56 - full) * this.collapse, this.getMeasuredHeight());
    }
  }

  protected override onDraw(canvas: Canvas): void {
    if (this.collapse >= 1) {
      // only the icon, centered
      const icon = this.getIcon();
      if (icon) {
        const s = this.getIconSize();
        icon.setBounds((this.getWidth() - s) / 2, (this.getHeight() - s) / 2, (this.getWidth() + s) / 2, (this.getHeight() + s) / 2);
        icon.draw(canvas);
      }
      return;
    }
    if (this.collapse > 0) {
      canvas.save();
      canvas.clipRect(0, 0, this.getWidth(), this.getHeight());
      canvas.writer.alpha(1 - this.collapse);
      super.onDraw(canvas);
      canvas.restore();
      return;
    }
    super.onDraw(canvas);
  }
}
