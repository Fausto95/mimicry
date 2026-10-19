/**
 * Text measurement is the one place the engine needs a font rasterizer.
 * In the browser it is an OffscreenCanvas inside the engine worker; in Node
 * it is @napi-rs/canvas with the same font files, which is what makes
 * headless screenshots deterministic.
 */
export interface FontMetrics {
  ascent: number;
  descent: number;
}

export interface TextMeasurer {
  width(text: string, font: string, letterSpacing: number): number;
  metrics(font: string): FontMetrics;
  /** forget cached measurements (a font finished loading) */
  invalidate?(): void;
}

/** The subset of CanvasRenderingContext2D the measurer needs. */
export interface MeasuringContext {
  font: string;
  letterSpacing?: string;
  measureText(text: string): {
    width: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
    actualBoundingBoxAscent?: number;
    actualBoundingBoxDescent?: number;
  };
}

export class CanvasTextMeasurer implements TextMeasurer {
  private readonly widths = new Map<string, Map<string, number>>();
  private readonly metricsCache = new Map<string, FontMetrics>();
  private readonly hasLetterSpacing: boolean;
  private currentFont = '';
  private currentSpacing = 0;
  private entries = 0;

  constructor(private readonly ctx: MeasuringContext) {
    this.hasLetterSpacing = 'letterSpacing' in ctx;
  }

  private use(font: string, spacing: number): void {
    if (this.currentFont !== font) {
      this.ctx.font = font;
      this.currentFont = font;
    }
    if (this.hasLetterSpacing && this.currentSpacing !== spacing) {
      this.ctx.letterSpacing = `${spacing}px`;
      this.currentSpacing = spacing;
    }
  }

  invalidate(): void {
    this.widths.clear();
    this.metricsCache.clear();
    this.entries = 0;
    this.currentFont = '';
  }

  width(text: string, font: string, letterSpacing: number): number {
    const key = letterSpacing ? `${font}|${letterSpacing}` : font;
    let table = this.widths.get(key);
    if (!table) {
      table = new Map();
      this.widths.set(key, table);
    }
    let w = table.get(text);
    if (w === undefined) {
      this.use(font, letterSpacing);
      w = this.ctx.measureText(text).width;
      if (letterSpacing && !this.hasLetterSpacing) w += letterSpacing * Array.from(text).length;
      if (++this.entries > 50_000) {
        this.widths.clear();
        this.entries = 0;
      }
      table.set(text, w);
    }
    return w;
  }

  metrics(font: string): FontMetrics {
    let m = this.metricsCache.get(font);
    if (!m) {
      this.use(font, 0);
      const t = this.ctx.measureText('Hg');
      const size = fontSizeOf(font);
      m = {
        ascent: t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? size * 0.8,
        descent: t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? size * 0.2,
      };
      this.metricsCache.set(font, m);
    }
    return m;
  }
}

/**
 * Deterministic fallback used when no canvas is available. Widths are
 * estimated from character classes; good enough for layout unit tests.
 */
export class EstimatingTextMeasurer implements TextMeasurer {
  width(text: string, font: string, letterSpacing: number): number {
    const size = fontSizeOf(font);
    const bold = /\b(6|7|8|9)00\b|bold/.test(font) ? 1.06 : 1;
    let w = 0;
    for (const ch of text) {
      if (/[⺀-鿿가-힯]/.test(ch)) w += 1;
      else if (/[ il.,:;'|!]/.test(ch)) w += 0.28;
      else if (/[mwMW@]/.test(ch)) w += 0.85;
      else if (/[A-Z0-9]/.test(ch)) w += 0.66;
      else w += 0.53;
      w += letterSpacing / size;
    }
    return w * size * bold;
  }

  metrics(font: string): FontMetrics {
    const size = fontSizeOf(font);
    return { ascent: size * 0.96875, descent: size * 0.2421875 };
  }
}

export function fontSizeOf(font: string): number {
  const m = /([\d.]+)px/.exec(font);
  return m ? parseFloat(m[1]!) : 14;
}
