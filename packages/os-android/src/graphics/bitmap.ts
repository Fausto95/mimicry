import type { ImageConsumer, ImageEntry, Kernel } from '@mimicry/os-core';
import { Looper } from '../os/looper';
import { RectF, type Canvas } from './canvas';
import { Color } from './color';
import { Drawable } from './drawable';
import type { Outline } from '../view/outline';

/**
 * android.graphics.Bitmap / BitmapFactory / BitmapDrawable over the
 * kernel's image service. The host owns decoded pixels, so a Bitmap is a
 * handle to an image URI plus its size.
 *
 * Deviation: decoding is asynchronous. BitmapFactory returns at once with a
 * bitmap whose size is 0 × 0 until the host reports it decoded; then
 * `addOnLoadedListener` callbacks run and drawables showing it re-measure
 * their views (an ImageView with wrap_content grows when it arrives).
 *
 * Like on a device, a decoded bitmap has the display's density, so its
 * pixels map 1:1 to screen pixels and its size in dp is pixels ÷ density.
 */
export enum BitmapConfig {
  ALPHA_8 = 1,
  RGB_565 = 3,
  ARGB_4444 = 4,
  ARGB_8888 = 5,
  RGBA_F16 = 6,
  HARDWARE = 7,
}

export class Bitmap implements ImageConsumer {
  static readonly Config = BitmapConfig;
  static readonly DENSITY_NONE = 0;

  private width = 0;
  private height = 0;
  private state: 'loading' | 'loaded' | 'error';
  private error: string | null = null;
  private density: number;
  private recycled = false;
  private readonly listeners = new Set<(bitmap: Bitmap) => void>();
  /** a solid color for bitmaps created empty (Bitmap.createBitmap) */
  private fill: number | null = null;

  /** @internal use BitmapFactory or Bitmap.createBitmap */
  constructor(readonly uri: string, private readonly kernel: Kernel, size?: { width: number; height: number }) {
    this.density = Math.round(kernel.viewport.scale * 160);
    if (size) {
      this.width = size.width;
      this.height = size.height;
      this.state = 'loaded';
      return;
    }
    const entry = kernel.images.get(uri, this);
    this.state = entry.state;
    if (entry.state === 'loaded') {
      this.width = entry.width;
      this.height = entry.height;
    }
  }

  get alive(): boolean {
    return !this.recycled;
  }

  /** @internal ImageConsumer */
  imageLoaded(entry: ImageEntry): void {
    const changed = this.state !== 'loaded' || this.width !== entry.width || this.height !== entry.height;
    this.state = 'loaded';
    this.width = entry.width;
    this.height = entry.height;
    if (changed) for (const l of Array.from(this.listeners)) l(this);
  }

  /** @internal ImageConsumer */
  imageFailed(entry: ImageEntry): void {
    this.state = 'error';
    this.error = entry.error ?? 'decode failed';
    for (const l of Array.from(this.listeners)) l(this);
  }

  /** Mimicry: run `listener` when the host has decoded the image (now, if it already has). */
  addOnLoadedListener(listener: (bitmap: Bitmap) => void): () => void {
    this.listeners.add(listener);
    if (this.state !== 'loading') this.kernel.defer(() => this.listeners.has(listener) && listener(this));
    return () => this.listeners.delete(listener);
  }

  isLoaded(): boolean {
    return this.state === 'loaded';
  }

  getLoadError(): string | null {
    return this.error;
  }

  /** Width in pixels (0 until decoded). */
  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getDensity(): number {
    return this.density;
  }

  setDensity(density: number): void {
    this.density = density;
  }

  /** The width in pixels on a display of `targetDensity` dpi. */
  getScaledWidth(targetDensity: number): number {
    return this.density === Bitmap.DENSITY_NONE || targetDensity === Bitmap.DENSITY_NONE ? this.width : Math.round((this.width * targetDensity) / this.density);
  }

  getScaledHeight(targetDensity: number): number {
    return this.density === Bitmap.DENSITY_NONE || targetDensity === Bitmap.DENSITY_NONE ? this.height : Math.round((this.height * targetDensity) / this.density);
  }

  /** Size in dp on this device (pixels ÷ density, or pixels for DENSITY_NONE). */
  sizeInDp(): { width: number; height: number } {
    const scale = this.kernel.viewport.scale;
    if (this.density === Bitmap.DENSITY_NONE) return { width: this.width / scale, height: this.height / scale };
    const dpi = scale * 160;
    return { width: this.getScaledWidth(dpi) / scale, height: this.getScaledHeight(dpi) / scale };
  }

  getConfig(): BitmapConfig {
    return BitmapConfig.ARGB_8888;
  }

  getByteCount(): number {
    return this.width * this.height * 4;
  }

  hasAlpha(): boolean {
    return true;
  }

  isRecycled(): boolean {
    return this.recycled;
  }

  recycle(): void {
    this.recycled = true;
    this.listeners.clear();
    this.kernel.images.forget(this);
  }

  /** @internal a solid-color bitmap's color */
  get solidColor(): number | null {
    return this.fill;
  }

  /** Bitmap.eraseColor: a created bitmap becomes a solid color. */
  eraseColor(color: number): void {
    this.fill = color;
  }

  /** Bitmap.createBitmap(width, height, config): an empty (transparent) bitmap. */
  static createBitmap(width: number, height: number, _config: BitmapConfig = BitmapConfig.ARGB_8888): Bitmap {
    const kernel = Looper.requireMainKernel();
    const bitmap = new Bitmap(`mimicry-bitmap:${width}x${height}:${nextBitmap++}`, kernel, { width, height });
    bitmap.fill = 0;
    return bitmap;
  }

  /** Bitmap.createScaledBitmap: the same image, reporting the new size. */
  static createScaledBitmap(src: Bitmap, dstWidth: number, dstHeight: number, _filter = true): Bitmap {
    const out = new Bitmap(src.uri, src.kernel, { width: dstWidth, height: dstHeight });
    out.fill = src.fill;
    out.scaledFrom = src;
    return out;
  }

  /** @internal source pixels for createScaledBitmap */
  scaledFrom: Bitmap | null = null;

  /** Draw the bitmap (or its solid color) into `dst`. */
  draw(canvas: Canvas, dst: RectF, tint = 0, src: RectF | null = null): void {
    if (this.fill !== null) {
      if (Color.alpha(this.fill)) canvas.writer.fillRect(dst.left, dst.top, dst.width(), dst.height(), Color.toRgba(this.fill));
      return;
    }
    const source = this.scaledFrom ?? this;
    if (!source.isLoaded() || !source.width || !source.height) return;
    const s = src ?? new RectF(0, 0, source.width, source.height);
    canvas.writer.image(dst.left, dst.top, dst.width(), dst.height(), s.left, s.top, s.width(), s.height(), tint, source.uri);
  }
}

let nextBitmap = 1;

/** BitmapFactory.Options: only inJustDecodeBounds-style queries and density are modeled. */
export class BitmapFactoryOptions {
  inJustDecodeBounds = false;
  inSampleSize = 1;
  inDensity = 0;
  inTargetDensity = 0;
  inScaled = true;
  outWidth = -1;
  outHeight = -1;
  outMimeType: string | null = null;
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return 'application/octet-stream';
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const BitmapFactory = {
  Options: BitmapFactoryOptions,

  /** A file path or URI the host can load (file://, http(s)://, data:, an absolute path). */
  decodeFile(pathName: string, opts?: BitmapFactoryOptions): Bitmap {
    const bitmap = new Bitmap(pathName, Looper.requireMainKernel());
    BitmapFactory.fillOptions(bitmap, opts);
    return bitmap;
  },

  /** Encoded bytes (PNG, JPEG, GIF, WebP) → a data: URI the host decodes. */
  decodeByteArray(data: Uint8Array | ArrayLike<number>, offset = 0, length?: number, opts?: BitmapFactoryOptions): Bitmap {
    const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
    const slice = bytes.subarray(offset, length === undefined ? bytes.length : offset + length);
    const mime = sniffMime(slice);
    const bitmap = new Bitmap(`data:${mime};base64,${base64(slice)}`, Looper.requireMainKernel());
    if (opts) opts.outMimeType = mime;
    BitmapFactory.fillOptions(bitmap, opts);
    return bitmap;
  },

  /** Resources are addressed by URI in Mimicry (there is no R.drawable table). */
  decodeResource(_res: unknown, uri: string, opts?: BitmapFactoryOptions): Bitmap {
    return BitmapFactory.decodeFile(uri, opts);
  },

  /** @internal */
  fillOptions(bitmap: Bitmap, opts: BitmapFactoryOptions | undefined): void {
    if (!opts) return;
    const update = () => {
      opts.outWidth = bitmap.getWidth();
      opts.outHeight = bitmap.getHeight();
    };
    update();
    bitmap.addOnLoadedListener(update);
  },
};

/**
 * android.graphics.drawable.BitmapDrawable: a bitmap stretched over the
 * drawable's bounds, intrinsically as big as the bitmap is in dp.
 */
export class BitmapDrawable extends Drawable {
  private tint: number | null = null;
  private removeListener: (() => void) | null = null;
  private readonly sizeListeners = new Set<() => void>();

  constructor(_resources: unknown, private bitmap: Bitmap | null) {
    super();
    this.watch();
  }

  private watch(): void {
    this.removeListener?.();
    this.removeListener = this.bitmap?.addOnLoadedListener(() => {
      for (const l of Array.from(this.sizeListeners)) l();
      this.invalidateSelf();
    }) ?? null;
  }

  /** @internal notified when the bitmap's size becomes known (ImageView re-measures) */
  onIntrinsicSizeChanged(listener: () => void): () => void {
    this.sizeListeners.add(listener);
    return () => this.sizeListeners.delete(listener);
  }

  getBitmap(): Bitmap | null {
    return this.bitmap;
  }

  setBitmap(bitmap: Bitmap | null): void {
    this.bitmap = bitmap;
    this.watch();
    this.invalidateSelf();
  }

  override getIntrinsicWidth(): number {
    return this.bitmap && this.bitmap.isLoaded() ? this.bitmap.sizeInDp().width : -1;
  }

  override getIntrinsicHeight(): number {
    return this.bitmap && this.bitmap.isLoaded() ? this.bitmap.sizeInDp().height : -1;
  }

  /** A single tint color, drawn SRC_IN (null clears it). */
  override setTint(tint: number | null): void {
    this.tint = tint;
    this.invalidateSelf();
  }

  override getOutline(outline: Outline): void {
    const b = this.getBounds();
    outline.setRect(b.left, b.top, b.right, b.bottom);
    outline.setAlpha(0);
  }

  draw(canvas: Canvas): void {
    if (!this.bitmap) return;
    const b = this.getBounds();
    const tint = this.tint != null ? Color.toRgba(this.tint) : 0;
    if (this.alpha < 255) {
      canvas.writer.save();
      canvas.writer.alpha(this.alpha / 255);
    }
    this.bitmap.draw(canvas, b, tint);
    if (this.alpha < 255) canvas.writer.restore();
  }
}
