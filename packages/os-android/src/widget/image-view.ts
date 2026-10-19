import type { Context } from '../content/context';
import type { ColorStateList } from '../content/color-state-list';
import { BitmapDrawable, BitmapFactory, type Bitmap } from '../graphics/bitmap';
import { RectF, type Canvas } from '../graphics/canvas';
import type { Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Matrix, ScaleToFit } from '../graphics/matrix';
import { MeasureSpec, View } from '../view/view';

/**
 * android.widget.ImageView: a drawable fitted into the view by a ScaleType
 * (configureBounds() in the framework), measured from the drawable's
 * intrinsic size, optionally keeping its aspect ratio (adjustViewBounds),
 * tinted (setImageTintList / setColorFilter, drawn SRC_IN) and faded
 * (setImageAlpha). Images that arrive later (bitmaps decode
 * asynchronously) re-measure the view.
 */
export enum ScaleType {
  MATRIX = 0,
  FIT_XY = 1,
  FIT_START = 2,
  FIT_CENTER = 3,
  FIT_END = 4,
  CENTER = 5,
  CENTER_CROP = 6,
  CENTER_INSIDE = 7,
}

/** android.graphics.PorterDuff.Mode (color filters draw as a SRC_IN tint). */
export enum PorterDuffMode {
  CLEAR = 0, SRC = 1, DST = 2, SRC_OVER = 3, DST_OVER = 4, SRC_IN = 5, DST_IN = 6, SRC_OUT = 7, DST_OUT = 8,
  SRC_ATOP = 9, DST_ATOP = 10, XOR = 11, DARKEN = 16, LIGHTEN = 17, MULTIPLY = 13, SCREEN = 14, ADD = 12, OVERLAY = 15,
}

export const PorterDuff = { Mode: PorterDuffMode } as const;

export class PorterDuffColorFilter {
  constructor(readonly color: number, readonly mode: PorterDuffMode = PorterDuffMode.SRC_ATOP) {}
}

export class ImageView extends View {
  override getAccessibilityClassName(): string {
    return 'android.widget.ImageView';
  }

  static readonly ScaleType = ScaleType;

  private drawable: Drawable | null = null;
  private scaleType = ScaleType.FIT_CENTER;
  private matrix = new Matrix();
  private drawMatrix: Matrix | null = null;
  private adjustViewBounds = false;
  private maxWidth = Number.MAX_SAFE_INTEGER;
  private maxHeight = Number.MAX_SAFE_INTEGER;
  private cropToPadding = false;
  private tintList: ColorStateList | null = null;
  private filterColor: number | null = null;
  private imageAlpha = 255;
  /** whether the drawable carries a tint this view applied */
  private tinted = false;
  private drawableWidth = -1;
  private drawableHeight = -1;
  private unwatch: (() => void) | null = null;

  constructor(context: Context) {
    super(context);
  }

  // ── content ─────────────────────────────────────────────────────────

  setImageDrawable(drawable: Drawable | null): void {
    if (this.drawable === drawable) return;
    this.drawable?.setCallback(null);
    this.unwatch?.();
    this.unwatch = null;
    this.drawable = drawable;
    this.tinted = false;
    if (drawable) {
      drawable.setCallback(this);
      if (drawable.isStateful()) drawable.setState(this.getDrawableState());
      drawable.setAlpha(this.imageAlpha);
      if (drawable instanceof BitmapDrawable) this.unwatch = drawable.onIntrinsicSizeChanged(() => this.updateDrawableSize());
    }
    this.applyTint();
    this.updateDrawableSize(true);
  }

  getDrawable(): Drawable | null {
    return this.drawable;
  }

  setImageBitmap(bitmap: Bitmap | null): void {
    this.setImageDrawable(bitmap ? new BitmapDrawable(this.context.getResources(), bitmap) : null);
  }

  /** A URI the host can load (file://, https://, data:, an absolute path). */
  setImageURI(uri: string | null): void {
    this.setImageBitmap(uri ? BitmapFactory.decodeFile(uri) : null);
  }

  /**
   * Mimicry has no R.drawable table: a resource is a Material Symbols icon
   * name ('favorite', 'arrow_back') or an image URI.
   */
  setImageResource(resource: string | Drawable): void {
    if (typeof resource !== 'string') this.setImageDrawable(resource);
    else if (/^[a-z0-9_]+$/.test(resource)) this.setImageDrawable(new MaterialIconDrawable(this.context, resource));
    else this.setImageURI(resource);
  }

  private updateDrawableSize(force = false): void {
    const d = this.drawable;
    const w = d ? d.getIntrinsicWidth() : -1;
    const h = d ? d.getIntrinsicHeight() : -1;
    if (force || w !== this.drawableWidth || h !== this.drawableHeight) {
      this.drawableWidth = w;
      this.drawableHeight = h;
      this.requestLayout();
    }
    this.configureBounds();
    this.invalidate();
  }

  // ── scale type ──────────────────────────────────────────────────────

  setScaleType(scaleType: ScaleType): void {
    this.scaleType = scaleType;
    this.configureBounds();
    this.invalidate();
  }

  getScaleType(): ScaleType {
    return this.scaleType;
  }

  /** Used with ScaleType.MATRIX. */
  setImageMatrix(matrix: Matrix | null): void {
    this.matrix = matrix ? new Matrix(matrix) : new Matrix();
    this.configureBounds();
    this.invalidate();
  }

  getImageMatrix(): Matrix {
    return this.drawMatrix ? new Matrix(this.drawMatrix) : new Matrix(this.matrix);
  }

  setAdjustViewBounds(adjust: boolean): void {
    this.adjustViewBounds = adjust;
    if (adjust) this.setScaleType(ScaleType.FIT_CENTER);
    this.requestLayout();
  }

  getAdjustViewBounds(): boolean {
    return this.adjustViewBounds;
  }

  setMaxWidth(maxWidth: number): void {
    this.maxWidth = maxWidth;
    this.requestLayout();
  }

  setMaxHeight(maxHeight: number): void {
    this.maxHeight = maxHeight;
    this.requestLayout();
  }

  setCropToPadding(crop: boolean): void {
    this.cropToPadding = crop;
    this.invalidate();
  }

  // ── tint ────────────────────────────────────────────────────────────

  setImageTintList(tint: ColorStateList | null): void {
    this.tintList = tint;
    this.applyTint();
  }

  getImageTintList(): ColorStateList | null {
    return this.tintList;
  }

  /** setColorFilter(color[, mode]) or setColorFilter(PorterDuffColorFilter): drawn as a tint. */
  setColorFilter(filter: number | PorterDuffColorFilter | null, _mode: PorterDuffMode = PorterDuffMode.SRC_ATOP): void {
    this.filterColor = filter == null ? null : typeof filter === 'number' ? filter : filter.color;
    this.applyTint();
  }

  clearColorFilter(): void {
    this.setColorFilter(null);
  }

  setImageAlpha(alpha: number): void {
    this.imageAlpha = alpha & 255;
    this.drawable?.setAlpha(this.imageAlpha);
    this.invalidate();
  }

  getImageAlpha(): number {
    return this.imageAlpha;
  }

  private applyTint(): void {
    const d = this.drawable;
    if (!d) return;
    // Without a tint or filter the drawable keeps its own colors.
    if (this.filterColor != null) d.setTint(this.filterColor);
    else if (this.tintList) d.setTint(this.tintList.getColorForState(this.getDrawableState(), this.tintList.getDefaultColor()));
    else if (this.tinted) d.setTint(null);
    this.tinted = this.filterColor != null || this.tintList != null;
    this.invalidate();
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    if (this.drawable?.isStateful()) this.drawable.setState(this.getDrawableState());
    if (this.tintList?.isStateful()) this.applyTint();
  }

  // ── measure & layout ────────────────────────────────────────────────

  private static resolveAdjustedSize(desired: number, max: number, spec: number): number {
    const mode = MeasureSpec.getMode(spec);
    const size = MeasureSpec.getSize(spec);
    switch (mode) {
      case MeasureSpec.UNSPECIFIED: return Math.min(desired, max);
      case MeasureSpec.AT_MOST: return Math.min(Math.min(desired, size), max);
      default: return size;
    }
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    let w: number;
    let h: number;
    let desiredAspect = 0;
    let resizeWidth = false;
    let resizeHeight = false;
    const widthMode = MeasureSpec.getMode(widthMeasureSpec);
    const heightMode = MeasureSpec.getMode(heightMeasureSpec);
    if (!this.drawable) {
      this.drawableWidth = -1;
      this.drawableHeight = -1;
      w = h = 0;
    } else {
      w = this.drawableWidth;
      h = this.drawableHeight;
      if (w <= 0) w = 1;
      if (h <= 0) h = 1;
      if (this.adjustViewBounds) {
        resizeWidth = widthMode !== MeasureSpec.EXACTLY;
        resizeHeight = heightMode !== MeasureSpec.EXACTLY;
        desiredAspect = w / h;
      }
    }
    const pl = this.getPaddingLeft();
    const pr = this.getPaddingRight();
    const pt = this.getPaddingTop();
    const pb = this.getPaddingBottom();
    let widthSize: number;
    let heightSize: number;
    if (resizeWidth || resizeHeight) {
      widthSize = ImageView.resolveAdjustedSize(w + pl + pr, this.maxWidth, widthMeasureSpec);
      heightSize = ImageView.resolveAdjustedSize(h + pt + pb, this.maxHeight, heightMeasureSpec);
      if (desiredAspect !== 0) {
        const actualAspect = (widthSize - pl - pr) / (heightSize - pt - pb);
        if (Math.abs(actualAspect - desiredAspect) > 1e-7) {
          let done = false;
          if (resizeWidth) {
            const newWidth = desiredAspect * (heightSize - pt - pb) + pl + pr;
            if (!resizeHeight) widthSize = ImageView.resolveAdjustedSize(newWidth, this.maxWidth, widthMeasureSpec);
            if (newWidth <= widthSize) {
              widthSize = newWidth;
              done = true;
            }
          }
          if (!done && resizeHeight) {
            const newHeight = (widthSize - pl - pr) / desiredAspect + pt + pb;
            if (!resizeWidth) heightSize = ImageView.resolveAdjustedSize(newHeight, this.maxHeight, heightMeasureSpec);
            if (newHeight <= heightSize) heightSize = newHeight;
          }
        }
      }
    } else {
      w = Math.max(w + pl + pr, this.getSuggestedMinimumWidth());
      h = Math.max(h + pt + pb, this.getSuggestedMinimumHeight());
      widthSize = View.resolveSize(w, widthMeasureSpec);
      heightSize = View.resolveSize(h, heightMeasureSpec);
    }
    this.setMeasuredDimension(widthSize, heightSize);
  }

  protected override onSizeChanged(w: number, h: number, oldw: number, oldh: number): void {
    super.onSizeChanged(w, h, oldw, oldh);
    this.configureBounds();
  }

  override setPadding(left: number, top: number, right: number, bottom: number): void {
    super.setPadding(left, top, right, bottom);
    this.configureBounds();
  }

  /** ImageView.configureBounds: the drawable's bounds and the matrix that fits it. */
  private configureBounds(): void {
    const d = this.drawable;
    if (!d) return;
    const dw = d.getIntrinsicWidth();
    const dh = d.getIntrinsicHeight();
    const vw = this.getWidth() - this.getPaddingLeft() - this.getPaddingRight();
    const vh = this.getHeight() - this.getPaddingTop() - this.getPaddingBottom();
    const fits = (dw < 0 || vw === dw) && (dh < 0 || vh === dh);
    if (dw <= 0 || dh <= 0 || this.scaleType === ScaleType.FIT_XY) {
      d.setBounds(0, 0, vw, vh);
      this.drawMatrix = null;
      return;
    }
    d.setBounds(0, 0, dw, dh);
    const m = new Matrix();
    switch (this.scaleType) {
      case ScaleType.MATRIX:
        this.drawMatrix = this.matrix.isIdentity() ? null : new Matrix(this.matrix);
        return;
      case ScaleType.CENTER:
        m.setTranslate(Math.round((vw - dw) * 0.5), Math.round((vh - dh) * 0.5));
        break;
      case ScaleType.CENTER_CROP: {
        let scale: number;
        let dx = 0;
        let dy = 0;
        if (dw * vh > vw * dh) {
          scale = vh / dh;
          dx = (vw - dw * scale) * 0.5;
        } else {
          scale = vw / dw;
          dy = (vh - dh * scale) * 0.5;
        }
        m.setScale(scale, scale);
        m.postTranslate(Math.round(dx), Math.round(dy));
        break;
      }
      case ScaleType.CENTER_INSIDE: {
        const scale = dw <= vw && dh <= vh ? 1 : Math.min(vw / dw, vh / dh);
        m.setScale(scale, scale);
        m.postTranslate(Math.round((vw - dw * scale) * 0.5), Math.round((vh - dh * scale) * 0.5));
        break;
      }
      default: {
        if (fits) {
          this.drawMatrix = null;
          return;
        }
        const stf = this.scaleType === ScaleType.FIT_START ? ScaleToFit.START : this.scaleType === ScaleType.FIT_END ? ScaleToFit.END : ScaleToFit.CENTER;
        m.setRectToRect(new RectF(0, 0, dw, dh), new RectF(0, 0, vw, vh), stf);
      }
    }
    this.drawMatrix = m;
  }

  // ── drawing ─────────────────────────────────────────────────────────

  protected override onDraw(canvas: Canvas): void {
    const d = this.drawable;
    if (!d || this.drawableWidth === 0 || this.drawableHeight === 0) return;
    const w = this.getWidth();
    const h = this.getHeight();
    canvas.save();
    // A view's drawing stays inside its bounds (CENTER_CROP overflows otherwise).
    if (this.cropToPadding) canvas.clipRect(this.getPaddingLeft(), this.getPaddingTop(), w - this.getPaddingRight(), h - this.getPaddingBottom());
    else canvas.clipRect(0, 0, w, h);
    canvas.translate(this.getPaddingLeft(), this.getPaddingTop());
    if (this.drawMatrix) canvas.concat(this.drawMatrix);
    d.draw(canvas);
    canvas.restore();
  }

  override invalidateDrawable(who: Drawable): void {
    if (who === this.drawable) {
      const w = who.getIntrinsicWidth();
      const h = who.getIntrinsicHeight();
      if (w !== this.drawableWidth || h !== this.drawableHeight) this.updateDrawableSize();
      else this.invalidate();
      return;
    }
    super.invalidateDrawable(who);
  }
}
