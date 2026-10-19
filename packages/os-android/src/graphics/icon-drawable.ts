import { writePath } from '@mimicry/os-core';
import type { Context } from '../content/context';
import type { Canvas } from './canvas';
import { Color } from './color';
import { Drawable } from './drawable';

/**
 * Icon drawables:
 *
 * - MaterialIconDrawable draws a Material Symbols glyph by icon name
 *   ('home', 'search', 'arrow_back'…) from the font Mimicry bundles — the
 *   icons Material Components and Compose apps use. The bundled font is the
 *   outlined, weight-400 style, so `filled` icons draw outlined.
 * - VectorDrawable draws SVG path data in a viewport (android:pathData),
 *   for the app's own vector assets.
 *
 * Both are tinted with one color (setTint), ?attr/colorOnSurfaceVariant
 * (Material's colorControlNormal) by default.
 */
export const MATERIAL_SYMBOLS_FAMILY = 'Material Symbols';

export class MaterialIconDrawable extends Drawable {
  private tint: number;

  constructor(context: Context | null, private name: string, private size = 24, tint?: number) {
    super();
    this.tint = tint ?? context?.getTheme().resolveColor('colorControlNormal') ?? Color.BLACK;
  }

  getIconName(): string {
    return this.name;
  }

  setIconName(name: string): void {
    this.name = name;
    this.invalidateSelf();
  }

  setSize(size: number): void {
    this.size = size;
    this.invalidateSelf();
  }

  override setTint(tint: number | null): void {
    if (tint == null) return;
    this.tint = tint;
    this.invalidateSelf();
  }

  getTint(): number {
    return this.tint;
  }

  override getIntrinsicWidth(): number {
    return this.size;
  }

  override getIntrinsicHeight(): number {
    return this.size;
  }

  draw(canvas: Canvas): void {
    const b = this.getBounds();
    const size = Math.min(this.size, b.width() || this.size, b.height() || this.size);
    const x = b.left + (b.width() - size) / 2;
    const top = b.top + (b.height() - size) / 2;
    const color = Color.toRgba(this.tint);
    const alpha = (this.alpha / 255) * (Color.alpha(this.tint) / 255);
    if (alpha <= 0) return;
    const w = canvas.writer;
    w.font(`400 ${size}px "${MATERIAL_SYMBOLS_FAMILY}"`);
    // Material Symbols glyphs fill the em square above the baseline.
    w.text(x, top + size, alpha < 1 ? ((color & 0xffffff00) | Math.round(alpha * 255)) >>> 0 : color, 0, this.name);
  }
}

export interface VectorPath {
  pathData: string;
  /** ARGB fill (the drawable's tint when omitted) */
  fillColor?: number;
  /** ARGB stroke and width in viewport units */
  strokeColor?: number;
  strokeWidth?: number;
}

export class VectorDrawable extends Drawable {
  private tint: number | null;
  private readonly paths: VectorPath[];

  constructor(paths: string | VectorPath[], private readonly viewportWidth = 24, private readonly viewportHeight = 24, private readonly width = 24, private readonly height = 24, tint: number | null = null) {
    super();
    this.paths = typeof paths === 'string' ? [{ pathData: paths }] : paths;
    this.tint = tint;
  }

  override setTint(tint: number | null): void {
    this.tint = tint;
    this.invalidateSelf();
  }

  override getIntrinsicWidth(): number {
    return this.width;
  }

  override getIntrinsicHeight(): number {
    return this.height;
  }

  draw(canvas: Canvas): void {
    const b = this.getBounds();
    const sx = (b.width() || this.width) / this.viewportWidth;
    const sy = (b.height() || this.height) / this.viewportHeight;
    const map = (x: number, y: number): [number, number] => [b.left + x * sx, b.top + y * sy];
    const w = canvas.writer;
    const alpha = this.alpha / 255;
    const paint = (argb: number) => {
      const rgba = Color.toRgba(argb);
      return alpha < 1 ? ((rgba & 0xffffff00) | Math.round((rgba & 255) * alpha)) >>> 0 : rgba;
    };
    for (const p of this.paths) {
      // A tint replaces every color (SRC_IN); a fill of 0 means the path is not filled.
      if (p.fillColor !== 0) {
        const fill = this.tint ?? p.fillColor ?? Color.BLACK;
        if (Color.alpha(fill)) {
          writePath(w, p.pathData, map);
          w.fillPath(paint(fill), 0);
        }
      }
      if (p.strokeColor != null && p.strokeWidth) {
        writePath(w, p.pathData, map);
        w.strokePath(paint(this.tint ?? p.strokeColor), p.strokeWidth * Math.min(sx, sy), 1, 1);
      }
    }
  }
}

/** Material icon path data used by the framework's own widgets (Apache 2.0). */
export const MaterialIconPaths = {
  arrowBack: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  moreVert: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  remove: 'M19 13H5v-2h14v2z',
} as const;
