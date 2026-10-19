import { union, type FrameTask, type LayerContext, type Rect } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { CAEnvironment, mediaNow } from '../quartz-core/ca-media-time';
import { UIColor } from './ui-color';
import type { UIImage } from './ui-image';
import { UIView, UIViewContentMode, UIViewNoIntrinsicMetric } from './ui-view';

/**
 * UIImageView: shows an image (or `highlightedImage` while highlighted)
 * placed by `contentMode` — every UIView.ContentMode, overflowing the
 * bounds unless clipsToBounds, like UIKit. Template images and symbols take
 * the view's tintColor. The intrinsic size is the image's; when a bitmap
 * finishes loading the view re-lays out its superview and redraws.
 * `animationImages` cycle over `animationDuration` (default: 1/30 s per
 * image), `animationRepeatCount` times (0: forever).
 */
export class UIImageView extends UIView implements FrameTask {
  private _image: UIImage | null = null;
  private _highlightedImage: UIImage | null = null;
  private _isHighlighted = false;
  private unobserve: Array<() => void> = [];
  animationImages: UIImage[] | null = null;
  highlightedAnimationImages: UIImage[] | null = null;
  animationDuration = 0;
  animationRepeatCount = 0;
  private animationStart: number | null = null;
  /** UIImageView(image:) sets frame to the image size */
  constructor(frameOrImage?: CGRect | UIImage | null, highlightedImage: UIImage | null = null) {
    super(frameOrImage && 'origin' in frameOrImage ? frameOrImage : undefined);
    this.isUserInteractionEnabled = false;
    if (frameOrImage && !('origin' in frameOrImage)) {
      this.image = frameOrImage;
      this._highlightedImage = highlightedImage;
      const size = frameOrImage.size;
      this.frame = { origin: { x: 0, y: 0 }, size };
    }
  }

  get image(): UIImage | null {
    return this._image;
  }

  set image(image: UIImage | null) {
    if (image === this._image) return;
    this._image = image;
    this.observeImages();
  }

  get highlightedImage(): UIImage | null {
    return this._highlightedImage;
  }

  set highlightedImage(image: UIImage | null) {
    this._highlightedImage = image;
    this.observeImages();
  }

  get isHighlighted(): boolean {
    return this._isHighlighted;
  }

  set isHighlighted(highlighted: boolean) {
    this._isHighlighted = highlighted;
    this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  /** The image drawn now (highlight and animation frames applied). */
  get currentImage(): UIImage | null {
    const frames = (this._isHighlighted && this.highlightedAnimationImages) || this.animationImages;
    if (this.isAnimating && frames?.length) return frames[this.frameIndex(frames.length)] ?? null;
    return (this._isHighlighted && this._highlightedImage) || this._image;
  }

  private observeImages(): void {
    for (const off of this.unobserve.splice(0)) off();
    for (const image of [this._image, this._highlightedImage]) {
      if (!image) continue;
      this.unobserve.push(image._observe(() => {
        this.invalidateIntrinsicContentSize();
        this.setNeedsDisplay();
      }));
    }
    this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  override get intrinsicContentSize(): CGSize {
    const image = (this._isHighlighted && this._highlightedImage) || this._image;
    if (!image) return { width: UIViewNoIntrinsicMetric, height: UIViewNoIntrinsicMetric };
    return image.size;
  }

  override sizeThatFits(size: CGSize): CGSize {
    const image = this._image;
    return image ? image.size : super.sizeThatFits(size);
  }

  override tintColorDidChange(): void {
    super.tintColorDidChange();
    this.setNeedsDisplay();
  }

  // ── animation images ──────────────────────────────────────────────────

  get isAnimating(): boolean {
    return this.animationStart !== null;
  }

  startAnimating(): void {
    if (!this.animationImages?.length) return;
    const kernel = CAEnvironment.kernel;
    this.animationStart = mediaNow(kernel);
    kernel?.animator.add(this);
    kernel?.requestFrame();
  }

  stopAnimating(): void {
    this.animationStart = null;
    this.setNeedsDisplay();
  }

  private get cycle(): number {
    const n = this.animationImages?.length ?? 0;
    return (this.animationDuration > 0 ? this.animationDuration : n / 30) * 1000;
  }

  private frameIndex(n: number): number {
    const elapsed = mediaNow(CAEnvironment.kernel) - (this.animationStart ?? 0);
    return Math.min(n - 1, Math.floor(((elapsed % this.cycle) / this.cycle) * n));
  }

  tick(): boolean {
    if (this.animationStart === null) return false;
    const elapsed = mediaNow(CAEnvironment.kernel) - this.animationStart;
    if (this.animationRepeatCount > 0 && elapsed >= this.cycle * this.animationRepeatCount) {
      this.animationStart = null;
    }
    this.setNeedsDisplay();
    return this.animationStart !== null;
  }

  // ── drawing ───────────────────────────────────────────────────────────

  /** Where the image goes in the bounds for the content mode (points, view space). */
  imageRect(image: UIImage, bounds: CGSize = this.bounds.size): CGRect {
    const iw = image.size.width;
    const ih = image.size.height;
    const bw = bounds.width;
    const bh = bounds.height;
    const M = UIViewContentMode;
    const at = (x: number, y: number, w = iw, h = ih): CGRect => ({ origin: { x, y }, size: { width: w, height: h } });
    if (!iw || !ih) return at(0, 0, bw, bh);
    switch (this.contentMode) {
      case M.scaleToFill:
      case M.redraw:
        return at(0, 0, bw, bh);
      case M.scaleAspectFit: {
        const s = Math.min(bw / iw, bh / ih);
        return at((bw - iw * s) / 2, (bh - ih * s) / 2, iw * s, ih * s);
      }
      case M.scaleAspectFill: {
        const s = Math.max(bw / iw, bh / ih);
        return at((bw - iw * s) / 2, (bh - ih * s) / 2, iw * s, ih * s);
      }
      case M.center: return at((bw - iw) / 2, (bh - ih) / 2);
      case M.top: return at((bw - iw) / 2, 0);
      case M.bottom: return at((bw - iw) / 2, bh - ih);
      case M.left: return at(0, (bh - ih) / 2);
      case M.right: return at(bw - iw, (bh - ih) / 2);
      case M.topLeft: return at(0, 0);
      case M.topRight: return at(bw - iw, 0);
      case M.bottomLeft: return at(0, bh - ih);
      case M.bottomRight: return at(bw - iw, bh - ih);
    }
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const image = this.currentImage;
    if (!image || !image.isLoaded) return;
    const r = this.imageRect(image);
    const dest = { origin: { x: ctx.x + r.origin.x, y: ctx.y + r.origin.y }, size: r.size };
    const traits = this.traitCollection;
    const tint = (this.tintColor ?? UIColor.tintColor).resolvedColor(traits).rgba;
    const box: Rect = { x: ctx.x, y: ctx.y, w: this.bounds.size.width, h: this.bounds.size.height };
    const drawn: Rect = { x: dest.origin.x, y: dest.origin.y, w: dest.size.width, h: dest.size.height };
    // Overflowing images (aspect fill, center…) draw past the bounds unless the layer masks them.
    const clip = this.clipsToBounds;
    if (clip) ctx.pushClip({ ...box, radii: this.layer.radii });
    ctx.item(clip ? box : union(box, drawn), (w) => image._draw(w, dest, image.isTemplate || image.isSymbolImage ? tint : 0, traits));
    if (clip) ctx.popClip();
  }
}
