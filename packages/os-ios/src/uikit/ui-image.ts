import type { CommandWriter } from '@mimicry/protocol';
import type { ImageConsumer, ImageEntry, Kernel } from '@mimicry/os-core';
import type { CGPoint, CGRect, CGSize, UIEdgeInsets } from '../core-graphics/geometry';
import { UIEdgeInsetsZero } from '../core-graphics/geometry';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { SYMBOL_FONT_FAMILY, materialNameFor } from './sf-symbols';
import type { UIColor } from './ui-color';
import { UIFontTextStyle, dynamicTypeSize } from './ui-font';
import { UIGraphicsGetCurrentContext } from './ui-graphics';
import { UITraitCollection } from './ui-trait-collection';

/**
 * UIImage: a bitmap the host decodes (asset catalog names, files, data
 * URIs, through the kernel's image service) or an SF Symbol.
 *
 * Bitmaps load asynchronously here (the host decodes them), so a UIImage
 * learns its size when the load finishes and tells whoever shows it
 * (`_observe`) — UIImageView then re-lays out and redraws. Registering an
 * asset with its size makes `UIImage(named:)` know it at once, like a
 * catalog does.
 *
 * Symbols are glyphs of the bundled Material Symbols font (see
 * sf-symbols.ts), sized by their configuration (point size, text style,
 * scale); they draw as templates. Weights other than regular and
 * multicolor/hierarchical layers are not drawn (one face, one color).
 */
export enum UIImageRenderingMode { automatic = 0, alwaysOriginal = 1, alwaysTemplate = 2 }
export enum UIImageResizingMode { tile = 0, stretch = 1 }
export enum UIImageSymbolScale { default = -1, unspecified = 0, small = 1, medium = 2, large = 3 }
export enum UIImageSymbolWeight {
  unspecified = 0, ultraLight = 1, thin = 2, light = 3, regular = 4, medium = 5, semibold = 6, bold = 7, heavy = 8, black = 9,
}

/** Glyph size relative to the point size, per symbol scale (SF's small / medium / large). */
const SCALE_FACTOR: Record<number, number> = {
  [UIImageSymbolScale.small]: 0.8,
  [UIImageSymbolScale.medium]: 1,
  [UIImageSymbolScale.large]: 1.3,
};
/** Material glyphs carry more padding in their em box than SF symbols in theirs. */
const GLYPH_EM = 1.2;

/** UIImage.SymbolConfiguration */
export class UIImageSymbolConfiguration {
  pointSize = 0;
  weight = UIImageSymbolWeight.unspecified;
  scale = UIImageSymbolScale.unspecified;
  textStyle: UIFontTextStyle | null = null;
  hierarchicalColor: UIColor | null = null;
  paletteColors: UIColor[] | null = null;
  prefersMulticolor = false;

  static fromPointSize(pointSize: number, weight = UIImageSymbolWeight.unspecified, scale = UIImageSymbolScale.unspecified): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { pointSize, weight, scale });
  }

  static fromTextStyle(textStyle: UIFontTextStyle, scale = UIImageSymbolScale.unspecified): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { textStyle, scale });
  }

  static fromScale(scale: UIImageSymbolScale): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { scale });
  }

  static fromWeight(weight: UIImageSymbolWeight): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { weight });
  }

  static fromHierarchicalColor(color: UIColor): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { hierarchicalColor: color });
  }

  static fromPaletteColors(colors: UIColor[]): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { paletteColors: colors });
  }

  static preferringMulticolor(): UIImageSymbolConfiguration {
    return Object.assign(new UIImageSymbolConfiguration(), { prefersMulticolor: true });
  }

  static get unspecified(): UIImageSymbolConfiguration {
    return new UIImageSymbolConfiguration();
  }

  /** applying(_:) — the other configuration's set values win */
  applying(other: UIImageSymbolConfiguration | null): UIImageSymbolConfiguration {
    if (!other) return this;
    const out = Object.assign(new UIImageSymbolConfiguration(), this);
    if (other.pointSize) {
      out.pointSize = other.pointSize;
      out.textStyle = null;
    }
    if (other.textStyle) {
      out.textStyle = other.textStyle;
      out.pointSize = 0;
    }
    if (other.weight !== UIImageSymbolWeight.unspecified) out.weight = other.weight;
    if (other.scale !== UIImageSymbolScale.unspecified) out.scale = other.scale;
    if (other.hierarchicalColor) out.hierarchicalColor = other.hierarchicalColor;
    if (other.paletteColors) out.paletteColors = other.paletteColors;
    if (other.prefersMulticolor) out.prefersMulticolor = true;
    return out;
  }

  /** The glyph's point size (the body text style's when nothing says otherwise). */
  get resolvedPointSize(): number {
    const base = this.pointSize > 0
      ? this.pointSize
      : dynamicTypeSize(this.textStyle ?? UIFontTextStyle.body, UITraitCollection.current.preferredContentSizeCategory);
    return base * (SCALE_FACTOR[this.scale] ?? 1);
  }
}

export interface ImageAsset {
  uri: string;
  /** pixel size, when known up front */
  width?: number;
  height?: number;
  scale?: number;
  /** template image (an asset catalog's "Render As: Template Image") */
  template?: boolean;
}

const assets = new Map<string, ImageAsset>();

/** Shared load state of one URI: every UIImage of it, and who is waiting for it. */
class Bitmap implements ImageConsumer {
  width = 0;
  height = 0;
  state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  readonly listeners = new Set<() => void>();

  constructor(readonly uri: string) {}

  load(kernel: Kernel | null): void {
    if (this.state !== 'idle' || !kernel) return;
    this.state = 'loading';
    const entry = kernel.images.get(this.uri, this);
    if (entry.state === 'loaded') this.imageLoaded(entry);
  }

  imageLoaded(entry: ImageEntry): void {
    const changed = this.state !== 'loaded' || this.width !== entry.width || this.height !== entry.height;
    this.state = 'loaded';
    this.width = entry.width;
    this.height = entry.height;
    if (changed) for (const listener of Array.from(this.listeners)) listener();
  }

  imageFailed(): void {
    this.state = 'error';
    for (const listener of Array.from(this.listeners)) listener();
  }
}

/** Per device: a bitmap is loaded on the host of the kernel that asked for it. */
const bitmaps = new WeakMap<object, Map<string, Bitmap>>();
const NO_KERNEL = {};

function bitmap(uri: string): Bitmap {
  const key = CAEnvironment.kernel ?? NO_KERNEL;
  let byUri = bitmaps.get(key);
  if (!byUri) bitmaps.set(key, (byUri = new Map()));
  let b = byUri.get(uri);
  if (!b) byUri.set(uri, (b = new Bitmap(uri)));
  return b;
}

interface ImageSource {
  kind: 'bitmap' | 'symbol';
  /** bitmap URI, or the SF Symbol name */
  name: string;
  /** points per pixel divisor (@2x, @3x) */
  scale: number;
  /** size from the asset catalog before the bitmap loads */
  knownSize: CGSize | null;
  template: boolean;
}

export class UIImage {
  private constructor(
    private readonly source: ImageSource,
    readonly renderingMode: UIImageRenderingMode,
    readonly capInsets: UIEdgeInsets,
    readonly resizingMode: UIImageResizingMode,
    /** withTintColor(_:) */
    readonly tintColor: UIColor | null,
    readonly symbolConfiguration: UIImageSymbolConfiguration | null,
  ) {
    if (source.kind === 'bitmap') bitmap(source.name).load(CAEnvironment.kernel);
  }

  /** Mimicry's asset catalog: what UIImage(named:) finds. */
  static registerAsset(name: string, asset: ImageAsset | string): void {
    assets.set(name, typeof asset === 'string' ? { uri: asset } : asset);
  }

  /** UIImage(named:) — null when the catalog has no such asset. */
  static named(name: string): UIImage | null {
    const asset = assets.get(name);
    if (!asset) return null;
    const scale = asset.scale ?? 1;
    const knownSize = asset.width && asset.height ? { width: asset.width / scale, height: asset.height / scale } : null;
    return new UIImage({ kind: 'bitmap', name: asset.uri, scale, knownSize, template: !!asset.template }, UIImageRenderingMode.automatic, UIEdgeInsetsZero, UIImageResizingMode.tile, null, null);
  }

  /** UIImage(contentsOfFile:) — a file path, file:// URL or data URI (the scale comes from an @2x/@3x suffix). */
  static contentsOfFile(path: string): UIImage {
    const m = /@(\d)x\.\w+$/.exec(path);
    const scale = m ? Number(m[1]) : 1;
    return new UIImage({ kind: 'bitmap', name: path, scale, knownSize: null, template: false }, UIImageRenderingMode.automatic, UIEdgeInsetsZero, UIImageResizingMode.tile, null, null);
  }

  /** UIImage(data:scale:) — encoded PNG / JPEG / GIF / WebP bytes. */
  static fromData(data: Uint8Array, scale = 1): UIImage {
    const type = data[0] === 0x89 ? 'png' : data[0] === 0xff ? 'jpeg' : data[0] === 0x47 ? 'gif' : data[0] === 0x52 ? 'webp' : 'png';
    let binary = '';
    for (const byte of data) binary += String.fromCharCode(byte);
    const uri = `data:image/${type};base64,${btoa(binary)}`;
    return new UIImage({ kind: 'bitmap', name: uri, scale, knownSize: null, template: false }, UIImageRenderingMode.automatic, UIEdgeInsetsZero, UIImageResizingMode.tile, null, null);
  }

  /** UIImage(systemName:withConfiguration:) — an SF Symbol (null for an empty name). */
  static systemName(name: string, configuration: UIImageSymbolConfiguration | null = null): UIImage | null {
    if (!name) return null;
    return new UIImage({ kind: 'symbol', name, scale: 1, knownSize: null, template: true }, UIImageRenderingMode.automatic, UIEdgeInsetsZero, UIImageResizingMode.tile, null, configuration ?? new UIImageSymbolConfiguration());
  }

  // ── what it is ────────────────────────────────────────────────────────

  get isSymbolImage(): boolean {
    return this.source.kind === 'symbol';
  }

  /** the bitmap's URI, or the symbol's name */
  get uri(): string {
    return this.source.name;
  }

  get scale(): number {
    return this.isSymbolImage ? (CAEnvironment.kernel?.viewport.scale ?? 3) : this.source.scale;
  }

  /** Size in points (zero until a bitmap without a catalog size has loaded). */
  get size(): CGSize {
    if (this.isSymbolImage) {
      const s = Math.round(this.symbolConfiguration!.resolvedPointSize * GLYPH_EM * 3) / 3;
      return { width: s, height: s };
    }
    const b = bitmap(this.source.name);
    if (b.state === 'loaded') return { width: b.width / this.source.scale, height: b.height / this.source.scale };
    return this.source.knownSize ?? { width: 0, height: 0 };
  }

  /** Whether the pixels are available to draw. */
  get isLoaded(): boolean {
    return this.isSymbolImage || bitmap(this.source.name).state === 'loaded';
  }

  get isFailed(): boolean {
    return !this.isSymbolImage && bitmap(this.source.name).state === 'error';
  }

  /** Templates draw in a tint color, keeping only their alpha. */
  get isTemplate(): boolean {
    if (this.renderingMode === UIImageRenderingMode.alwaysTemplate) return true;
    if (this.renderingMode === UIImageRenderingMode.alwaysOriginal) return false;
    return this.source.template;
  }

  // ── variants ──────────────────────────────────────────────────────────

  withRenderingMode(mode: UIImageRenderingMode): UIImage {
    return new UIImage(this.source, mode, this.capInsets, this.resizingMode, this.tintColor, this.symbolConfiguration);
  }

  /** withTintColor(_:renderingMode:) — an image that always draws in `color`. */
  withTintColor(color: UIColor, renderingMode = UIImageRenderingMode.alwaysOriginal): UIImage {
    return new UIImage(this.source, renderingMode, this.capInsets, this.resizingMode, color, this.symbolConfiguration);
  }

  resizableImage(capInsets: UIEdgeInsets, resizingMode = UIImageResizingMode.tile): UIImage {
    return new UIImage(this.source, this.renderingMode, capInsets, resizingMode, this.tintColor, this.symbolConfiguration);
  }

  /** withConfiguration(_:) / applyingSymbolConfiguration(_:) */
  withConfiguration(configuration: UIImageSymbolConfiguration): UIImage {
    if (!this.isSymbolImage) return this;
    return new UIImage(this.source, this.renderingMode, this.capInsets, this.resizingMode, this.tintColor, this.symbolConfiguration!.applying(configuration));
  }

  applyingSymbolConfiguration(configuration: UIImageSymbolConfiguration): UIImage | null {
    return this.isSymbolImage ? this.withConfiguration(configuration) : null;
  }

  /** Same pixels and settings (UIImage identity for `isEqual`). */
  isEqual(other: UIImage | null): boolean {
    return !!other && other.source.kind === this.source.kind && other.source.name === this.source.name && other.renderingMode === this.renderingMode
      && other.tintColor === this.tintColor;
  }

  // ── drawing ───────────────────────────────────────────────────────────

  /** @internal be told when the image loads (or fails); returns an unsubscribe. */
  _observe(listener: () => void): () => void {
    if (this.isSymbolImage) return () => {};
    const b = bitmap(this.source.name);
    b.load(CAEnvironment.kernel);
    b.listeners.add(listener);
    return () => b.listeners.delete(listener);
  }

  /**
   * @internal Draw into `dest` (points). `tint` colors templates (packed
   * RGBA; 0 draws originals as they are). Resizable images stretch their
   * middle and keep their caps.
   */
  _draw(w: CommandWriter, dest: CGRect, tint: number, traits: UITraitCollection): void {
    const color = this.tintColor ? this.tintColor.resolvedColor(traits).rgba : tint;
    if (this.isSymbolImage) {
      this.drawSymbol(w, dest, color || 0x000000ff);
      return;
    }
    const b = bitmap(this.source.name);
    if (b.state !== 'loaded') return;
    const t = this.isTemplate || this.tintColor ? color : 0;
    const caps = this.capInsets;
    if (!caps.top && !caps.left && !caps.bottom && !caps.right) {
      w.image(dest.origin.x, dest.origin.y, dest.size.width, dest.size.height, 0, 0, b.width, b.height, t, this.source.name);
      return;
    }
    // Nine slices: corners keep their size, edges stretch along one axis, the middle along both.
    const s = this.source.scale;
    const sx = [0, caps.left * s, b.width - caps.right * s, b.width];
    const sy = [0, caps.top * s, b.height - caps.bottom * s, b.height];
    const { x, y } = dest.origin;
    const dx = [x, x + caps.left, x + dest.size.width - caps.right, x + dest.size.width];
    const dy = [y, y + caps.top, y + dest.size.height - caps.bottom, y + dest.size.height];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const sw = sx[c + 1]! - sx[c]!;
        const sh = sy[r + 1]! - sy[r]!;
        const dw = dx[c + 1]! - dx[c]!;
        const dh = dy[r + 1]! - dy[r]!;
        if (sw > 0 && sh > 0 && dw > 0 && dh > 0) w.image(dx[c]!, dy[r]!, dw, dh, sx[c]!, sy[r]!, sw, sh, t, this.source.name);
      }
    }
  }

  private drawSymbol(w: CommandWriter, dest: CGRect, color: number): void {
    const config = this.symbolConfiguration!;
    const glyph = materialNameFor(this.source.name);
    // The glyph fills its em box; fit the box into the destination.
    const size = Math.min(dest.size.width, dest.size.height);
    const palette = config.paletteColors?.[0] ?? config.hierarchicalColor;
    const ink = palette ? palette.resolvedColor(UITraitCollection.current).rgba : color;
    const font = `400 ${Math.round(size * 100) / 100}px "${SYMBOL_FONT_FAMILY}"`;
    const kernel = CAEnvironment.kernel;
    const m = kernel?.measurer.metrics(font) ?? { ascent: size * 0.95, descent: size * 0.05 };
    const width = kernel?.measurer.width(glyph, font, 0) ?? size;
    const x = dest.origin.x + (dest.size.width - width) / 2;
    const baseline = dest.origin.y + (dest.size.height - (m.ascent + m.descent)) / 2 + m.ascent;
    w.font(font);
    w.text(x, baseline, ink, 0, glyph);
  }

  /** draw(in:) into the current graphics context. */
  drawIn(rect: CGRect): void {
    const ctx = UIGraphicsGetCurrentContext();
    if (ctx) this._draw(ctx.writer, rect, 0x000000ff, ctx.traits);
  }

  /** draw(at:) */
  drawAt(point: CGPoint): void {
    this.drawIn({ origin: point, size: this.size });
  }
}
