import type { CommandWriter, Radii } from '@mimicry/protocol';
import { Color } from './color';

/**
 * android.graphics: RectF, Paint, Path and Canvas. A Canvas records into the
 * frame's draw commands in the drawing view's coordinates.
 */
export class RectF {
  constructor(public left = 0, public top = 0, public right = 0, public bottom = 0) {}
  width(): number {
    return this.right - this.left;
  }
  height(): number {
    return this.bottom - this.top;
  }
  centerX(): number {
    return (this.left + this.right) / 2;
  }
  centerY(): number {
    return (this.top + this.bottom) / 2;
  }
  set(left: number, top: number, right: number, bottom: number): void {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
  }
  contains(x: number, y: number): boolean {
    return x >= this.left && x < this.right && y >= this.top && y < this.bottom;
  }
  inset(dx: number, dy: number): void {
    this.left += dx;
    this.top += dy;
    this.right -= dx;
    this.bottom -= dy;
  }
}

export class Rect extends RectF {}

export enum PaintStyle { FILL = 0, STROKE = 1, FILL_AND_STROKE = 2 }
export enum PaintCap { BUTT = 0, ROUND = 1, SQUARE = 2 }
export enum PaintJoin { MITER = 0, ROUND = 1, BEVEL = 2 }
export enum PaintAlign { LEFT = 0, CENTER = 1, RIGHT = 2 }

export class Typeface {
  static readonly DEFAULT = new Typeface('Roboto', 400, false);
  static readonly DEFAULT_BOLD = new Typeface('Roboto', 700, false);
  static readonly SANS_SERIF = new Typeface('Roboto', 400, false);
  static readonly SERIF = new Typeface('Noto Serif', 400, false);
  static readonly MONOSPACE = new Typeface('Roboto Mono', 400, false);
  static readonly NORMAL = 0;
  static readonly BOLD = 1;
  static readonly ITALIC = 2;
  static readonly BOLD_ITALIC = 3;

  constructor(readonly family: string, readonly weight: number, readonly italic: boolean) {}

  static create(family: string | Typeface | null, style: number): Typeface {
    const name = family instanceof Typeface ? family.family : family ?? 'Roboto';
    return new Typeface(name, style & Typeface.BOLD ? 700 : 400, (style & Typeface.ITALIC) !== 0);
  }

  /** Typeface.create(Typeface, weight, italic) (API 28) */
  static createWeighted(family: Typeface, weight: number, italic: boolean): Typeface {
    return new Typeface(family.family, weight, italic);
  }

  isBold(): boolean {
    return this.weight >= 600;
  }

  isItalic(): boolean {
    return this.italic;
  }
}

export class Paint {
  static readonly ANTI_ALIAS_FLAG = 1;
  private color = Color.BLACK;
  private style = PaintStyle.FILL;
  private strokeWidth = 0;
  private cap = PaintCap.BUTT;
  private join = PaintJoin.MITER;
  private textSize = 14;
  private typeface: Typeface = Typeface.DEFAULT;
  private textAlign = PaintAlign.LEFT;
  private letterSpacing = 0;
  shadow: { radius: number; dx: number; dy: number; color: number } | null = null;

  constructor(flags = 0) {
    void flags;
  }

  setColor(color: number): void {
    this.color = color | 0;
  }
  getColor(): number {
    return this.color;
  }
  setAlpha(alpha: number): void {
    this.color = (this.color & 0x00ffffff) | ((alpha & 255) << 24);
  }
  getAlpha(): number {
    return Color.alpha(this.color);
  }
  setStyle(style: PaintStyle): void {
    this.style = style;
  }
  getStyle(): PaintStyle {
    return this.style;
  }
  setStrokeWidth(width: number): void {
    this.strokeWidth = width;
  }
  getStrokeWidth(): number {
    return this.strokeWidth;
  }
  setStrokeCap(cap: PaintCap): void {
    this.cap = cap;
  }
  getStrokeCap(): PaintCap {
    return this.cap;
  }
  setStrokeJoin(join: PaintJoin): void {
    this.join = join;
  }
  getStrokeJoin(): PaintJoin {
    return this.join;
  }
  setTextSize(size: number): void {
    this.textSize = size;
  }
  getTextSize(): number {
    return this.textSize;
  }
  setTypeface(typeface: Typeface | null): void {
    this.typeface = typeface ?? Typeface.DEFAULT;
  }
  getTypeface(): Typeface {
    return this.typeface;
  }
  setTextAlign(align: PaintAlign): void {
    this.textAlign = align;
  }
  getTextAlign(): PaintAlign {
    return this.textAlign;
  }
  setLetterSpacing(em: number): void {
    this.letterSpacing = em;
  }
  getLetterSpacing(): number {
    return this.letterSpacing;
  }
  setAntiAlias(_aa: boolean): void {}
  setShadowLayer(radius: number, dx: number, dy: number, color: number): void {
    this.shadow = { radius, dx, dy, color };
  }
  clearShadowLayer(): void {
    this.shadow = null;
  }

  /** css font for the text renderer */
  get cssFont(): string {
    const t = this.typeface;
    return `${t.italic ? 'italic ' : ''}${t.weight} ${this.textSize}px "${t.family}", Roboto, sans-serif`;
  }

  get rgba(): number {
    return Color.toRgba(this.color);
  }
}

type PathOp = (w: CommandWriter) => void;

export enum PathDirection { CW = 0, CCW = 1 }
export enum PathFillType { WINDING = 0, EVEN_ODD = 1 }

export class Path {
  private ops: PathOp[] = [];
  private fillType = PathFillType.WINDING;

  reset(): void {
    this.ops = [];
  }
  moveTo(x: number, y: number): void {
    this.ops.push((w) => w.moveTo(x, y));
  }
  lineTo(x: number, y: number): void {
    this.ops.push((w) => w.lineTo(x, y));
  }
  quadTo(x1: number, y1: number, x2: number, y2: number): void {
    this.ops.push((w) => w.quadTo(x1, y1, x2, y2));
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.ops.push((w) => w.cubicTo(x1, y1, x2, y2, x3, y3));
  }
  /** arcTo(oval, startAngle°, sweepAngle°) on a circle inscribed in oval */
  arcTo(oval: RectF, startAngle: number, sweepAngle: number): void {
    const cx = oval.centerX();
    const cy = oval.centerY();
    const r = Math.min(oval.width(), oval.height()) / 2;
    const a0 = (startAngle * Math.PI) / 180;
    const a1 = ((startAngle + sweepAngle) * Math.PI) / 180;
    this.ops.push((w) => w.arc(cx, cy, r, a0, a1, sweepAngle < 0));
  }
  addRect(left: number, top: number, right: number, bottom: number, _dir: PathDirection = PathDirection.CW): void {
    this.moveTo(left, top);
    this.lineTo(right, top);
    this.lineTo(right, bottom);
    this.lineTo(left, bottom);
    this.close();
  }
  addCircle(x: number, y: number, radius: number, _dir: PathDirection = PathDirection.CW): void {
    this.ops.push((w) => w.moveTo(x + radius, y).arc(x, y, radius, 0, Math.PI * 2));
    this.close();
  }
  addRoundRect(rect: RectF, radii: number[] | number, _dir: PathDirection = PathDirection.CW): void {
    const r: number[] = typeof radii === 'number' ? [radii, radii, radii, radii, radii, radii, radii, radii] : radii;
    const [tl = 0, , tr = 0, , br = 0, , bl = 0] = r;
    const { left: x, top: y } = rect;
    const w = rect.width();
    const h = rect.height();
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    if (tr) this.quadTo(x + w, y, x + w, y + tr);
    this.lineTo(x + w, y + h - br);
    if (br) this.quadTo(x + w, y + h, x + w - br, y + h);
    this.lineTo(x + bl, y + h);
    if (bl) this.quadTo(x, y + h, x, y + h - bl);
    this.lineTo(x, y + tl);
    if (tl) this.quadTo(x, y, x + tl, y);
    this.close();
  }
  close(): void {
    this.ops.push((w) => w.closePath());
  }
  setFillType(type: PathFillType): void {
    this.fillType = type;
  }
  getFillType(): PathFillType {
    return this.fillType;
  }
  /** @internal */
  write(w: CommandWriter): void {
    w.pathBegin();
    for (const op of this.ops) op(w);
  }
}

/**
 * android.graphics.Canvas. Matrix and clip state stack with save/restore;
 * shapes honor the Paint's style (fill, stroke or both).
 */
export class Canvas {
  private depth = 0;

  constructor(private readonly w: CommandWriter, private readonly widthPx = 0, private readonly heightPx = 0) {}

  getWidth(): number {
    return this.widthPx;
  }

  getHeight(): number {
    return this.heightPx;
  }

  save(): number {
    this.w.save();
    return ++this.depth;
  }

  restore(): void {
    if (this.depth <= 0) return;
    this.depth--;
    this.w.restore();
  }

  restoreToCount(count: number): void {
    while (this.depth >= count) this.restore();
  }

  getSaveCount(): number {
    return this.depth + 1;
  }

  translate(dx: number, dy: number): void {
    this.w.transform(1, 0, 0, 1, dx, dy);
  }

  scale(sx: number, sy: number, px = 0, py = 0): void {
    if (px || py) this.translate(px, py);
    this.w.transform(sx, 0, 0, sy, 0, 0);
    if (px || py) this.translate(-px, -py);
  }

  rotate(degrees: number, px = 0, py = 0): void {
    const a = (degrees * Math.PI) / 180;
    if (px || py) this.translate(px, py);
    this.w.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0);
    if (px || py) this.translate(-px, -py);
  }

  clipRect(left: number, top: number, right: number, bottom: number): boolean {
    this.w.clipRect(left, top, right - left, bottom - top);
    return true;
  }

  clipPath(path: Path): boolean {
    path.write(this.w);
    this.w.clipPath(path.getFillType());
    return true;
  }

  drawColor(color: number): void {
    this.w.fillRect(-1e5, -1e5, 2e5, 2e5, Color.toRgba(color));
  }

  drawRect(left: number | RectF, top?: number | Paint, right?: number, bottom?: number, paint?: Paint): void {
    let l: number, t: number, r: number, b: number, p: Paint;
    if (left instanceof RectF) {
      ({ left: l, top: t, right: r, bottom: b } = left);
      p = top as Paint;
    } else {
      l = left;
      t = top as number;
      r = right!;
      b = bottom!;
      p = paint!;
    }
    this.shape(p, (w) => w.fillRect(l, t, r - l, b - t, p.rgba), (w, lw) => w.strokeRRect(l, t, r - l, b - t, [0, 0, 0, 0], lw, p.rgba));
  }

  drawRoundRect(rect: RectF, rx: number, _ry: number, paint: Paint): void {
    const radii: Radii = [rx, rx, rx, rx];
    const { left: l, top: t } = rect;
    this.shape(paint, (w) => w.fillRRect(l, t, rect.width(), rect.height(), radii, paint.rgba), (w, lw) => w.strokeRRect(l, t, rect.width(), rect.height(), radii, lw, paint.rgba));
  }

  drawCircle(cx: number, cy: number, radius: number, paint: Paint): void {
    const path = new Path();
    path.addCircle(cx, cy, radius);
    this.drawPath(path, paint);
  }

  drawOval(oval: RectF, paint: Paint): void {
    const r = Math.min(oval.width(), oval.height()) / 2;
    this.drawCircle(oval.centerX(), oval.centerY(), r, paint);
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, paint: Paint): void {
    this.w.pathBegin().moveTo(x0, y0).lineTo(x1, y1).strokePath(paint.rgba, Math.max(1, paint.getStrokeWidth()), paint.getStrokeCap(), paint.getStrokeJoin());
  }

  drawPath(path: Path, paint: Paint): void {
    const style = paint.getStyle();
    if (style !== PaintStyle.STROKE) {
      path.write(this.w);
      this.w.fillPath(paint.rgba, path.getFillType());
    }
    if (style !== PaintStyle.FILL) {
      path.write(this.w);
      this.w.strokePath(paint.rgba, Math.max(1, paint.getStrokeWidth()), paint.getStrokeCap(), paint.getStrokeJoin());
    }
  }

  drawText(text: string, x: number, y: number, paint: Paint): void {
    this.w.font(paint.cssFont);
    if (paint.shadow) this.w.shadow(Color.toRgba(paint.shadow.color), paint.shadow.radius * 2, paint.shadow.dx, paint.shadow.dy);
    this.w.text(x, y, paint.rgba, paint.getLetterSpacing() * paint.getTextSize(), text);
    if (paint.shadow) this.w.shadowClear();
  }

  /** draw a decoded bitmap (by URI) into dst */
  drawBitmap(uri: string, src: RectF | null, dst: RectF, size: { width: number; height: number }, tint = 0): void {
    const s = src ?? new RectF(0, 0, size.width, size.height);
    this.w.image(dst.left, dst.top, dst.width(), dst.height(), s.left, s.top, s.width(), s.height(), tint, uri);
  }

  private shape(paint: Paint, fill: (w: CommandWriter) => void, stroke: (w: CommandWriter, width: number) => void): void {
    const style = paint.getStyle();
    if (style !== PaintStyle.STROKE) fill(this.w);
    if (style !== PaintStyle.FILL) stroke(this.w, Math.max(1, paint.getStrokeWidth()));
  }

  /** the underlying command stream (for drawables that use the shared box painter) */
  get writer(): CommandWriter {
    return this.w;
  }
}
