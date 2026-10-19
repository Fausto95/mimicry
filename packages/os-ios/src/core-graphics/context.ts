import { LineCap, LineJoin, type CommandWriter } from '@mimicry/protocol';
import type { CGAffineTransform, CGPoint, CGRect } from './geometry';
import type { UIColor } from '../uikit/ui-color';
import type { UITraitCollection } from '../uikit/ui-trait-collection';

/**
 * CGContext: the Quartz 2D drawing API views use inside `draw(_:)`, recorded
 * straight into the frame's draw commands. Coordinates are the view's own
 * (the recorder origin is applied once, as a transform, when drawing starts).
 */
export enum CGLineCap { butt = 0, round = 1, square = 2 }
export enum CGLineJoin { miter = 0, round = 1, bevel = 2 }
export enum CGPathFillRule { winding = 0, evenOdd = 1 }

interface GState {
  fill: number;
  stroke: number;
  lineWidth: number;
  cap: number;
  join: number;
  alpha: number;
}

export class CGContext {
  private state: GState = { fill: 0x000000ff, stroke: 0x000000ff, lineWidth: 1, cap: LineCap.Butt, join: LineJoin.Miter, alpha: 1 };
  private readonly stack: GState[] = [];
  private pathOpen = false;

  constructor(
    /** the underlying command stream */
    readonly writer: CommandWriter,
    /** colors resolve against these traits (light/dark) */
    readonly traits: UITraitCollection,
  ) {}

  // ── graphics state ───────────────────────────────────────────────────

  saveGState(): void {
    this.stack.push({ ...this.state });
    this.writer.save();
  }

  restoreGState(): void {
    const s = this.stack.pop();
    if (s) this.state = s;
    this.writer.restore();
  }

  setFillColor(color: UIColor | number): void {
    this.state.fill = this.resolve(color);
  }

  setStrokeColor(color: UIColor | number): void {
    this.state.stroke = this.resolve(color);
  }

  setLineWidth(width: number): void {
    this.state.lineWidth = width;
  }

  setLineCap(cap: CGLineCap): void {
    this.state.cap = cap;
  }

  setLineJoin(join: CGLineJoin): void {
    this.state.join = join;
  }

  setAlpha(alpha: number): void {
    this.state.alpha = alpha;
    this.writer.alpha(alpha);
  }

  setShadow(offset: { width: number; height: number }, blur: number, color: UIColor | number = 0x00000055): void {
    this.writer.shadow(this.resolve(color), blur, offset.width, offset.height);
  }

  translateBy(x: number, y: number): void {
    this.writer.transform(1, 0, 0, 1, x, y);
  }

  scaleBy(sx: number, sy: number): void {
    this.writer.transform(sx, 0, 0, sy, 0, 0);
  }

  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.writer.transform(c, s, -s, c, 0, 0);
  }

  concatenate(t: CGAffineTransform): void {
    this.writer.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
  }

  clip(to: CGRect): void {
    this.writer.clipRect(to.origin.x, to.origin.y, to.size.width, to.size.height);
  }

  // ── paths ────────────────────────────────────────────────────────────

  beginPath(): void {
    this.writer.pathBegin();
    this.pathOpen = true;
  }

  private ensurePath(): void {
    if (!this.pathOpen) this.beginPath();
  }

  move(to: CGPoint): void {
    this.ensurePath();
    this.writer.moveTo(to.x, to.y);
  }

  addLine(to: CGPoint): void {
    this.ensurePath();
    this.writer.lineTo(to.x, to.y);
  }

  addQuadCurve(to: CGPoint, control: CGPoint): void {
    this.ensurePath();
    this.writer.quadTo(control.x, control.y, to.x, to.y);
  }

  addCurve(to: CGPoint, control1: CGPoint, control2: CGPoint): void {
    this.ensurePath();
    this.writer.cubicTo(control1.x, control1.y, control2.x, control2.y, to.x, to.y);
  }

  addArc(center: CGPoint, radius: number, startAngle: number, endAngle: number, clockwise: boolean): void {
    this.ensurePath();
    // UIKit's flipped coordinates: "clockwise" on screen is counter-clockwise in canvas terms.
    this.writer.arc(center.x, center.y, radius, startAngle, endAngle, clockwise);
  }

  addRect(rect: CGRect): void {
    const { x, y } = rect.origin;
    const { width: w, height: h } = rect.size;
    this.move({ x, y });
    this.addLine({ x: x + w, y });
    this.addLine({ x: x + w, y: y + h });
    this.addLine({ x, y: y + h });
    this.closePath();
  }

  addEllipse(rect: CGRect): void {
    const cx = rect.origin.x + rect.size.width / 2;
    const cy = rect.origin.y + rect.size.height / 2;
    const rx = rect.size.width / 2;
    const ry = rect.size.height / 2;
    this.ensurePath();
    if (Math.abs(rx - ry) < 1e-6) {
      this.writer.moveTo(cx + rx, cy).arc(cx, cy, rx, 0, Math.PI * 2);
    } else {
      const k = 0.5522847498;
      this.writer.moveTo(cx + rx, cy)
        .cubicTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
        .cubicTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
        .cubicTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
        .cubicTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
    }
    this.closePath();
  }

  closePath(): void {
    this.writer.closePath();
  }

  fillPath(rule: CGPathFillRule = CGPathFillRule.winding): void {
    this.writer.fillPath(this.state.fill, rule);
    this.pathOpen = false;
  }

  strokePath(): void {
    const s = this.state;
    this.writer.strokePath(s.stroke, s.lineWidth, s.cap, s.join);
    this.pathOpen = false;
  }

  clipToPath(rule: CGPathFillRule = CGPathFillRule.winding): void {
    this.writer.clipPath(rule);
    this.pathOpen = false;
  }

  // ── shapes ───────────────────────────────────────────────────────────

  fill(rect: CGRect): void {
    this.writer.fillRect(rect.origin.x, rect.origin.y, rect.size.width, rect.size.height, this.state.fill);
  }

  stroke(rect: CGRect): void {
    const s = this.state;
    this.writer.strokeRRect(rect.origin.x, rect.origin.y, rect.size.width, rect.size.height, [0, 0, 0, 0], s.lineWidth, s.stroke);
  }

  fillEllipse(rect: CGRect): void {
    this.beginPath();
    this.addEllipse(rect);
    this.fillPath();
  }

  strokeEllipse(rect: CGRect): void {
    this.beginPath();
    this.addEllipse(rect);
    this.strokePath();
  }

  clear(rect: CGRect): void {
    this.writer.fillRect(rect.origin.x, rect.origin.y, rect.size.width, rect.size.height, 0);
  }

  private resolve(color: UIColor | number): number {
    return typeof color === 'number' ? color : color.resolvedColor(this.traits).rgba;
  }
}
