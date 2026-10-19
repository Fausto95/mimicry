import { CompositeOp, Op } from './opcodes';

const encoder = new TextEncoder();

/**
 * Growable little-endian word buffer. Every write is 4-byte aligned, so the
 * resulting bytes can be hashed and read back as 32-bit words.
 */
export class WordWriter {
  protected bytes: Uint8Array;
  protected view: DataView;
  protected offset = 0;

  constructor(initialBytes = 1024) {
    this.bytes = new Uint8Array(initialBytes);
    this.view = new DataView(this.bytes.buffer);
  }

  get byteLength(): number {
    return this.offset;
  }

  protected ensure(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.bytes.byteLength) return;
    let size = this.bytes.byteLength * 2;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.offset));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u32(value: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
    return this;
  }

  f32(value: number): this {
    this.ensure(4);
    this.view.setFloat32(this.offset, Number.isFinite(value) ? value : 0, true);
    this.offset += 4;
    return this;
  }

  /** utf8 string: u32 byteLength, bytes, zero padding to a word boundary */
  string(value: string): this {
    const data = encoder.encode(value);
    const padded = (data.byteLength + 3) & ~3;
    this.ensure(4 + padded);
    this.view.setUint32(this.offset, data.byteLength, true);
    this.offset += 4;
    this.bytes.set(data, this.offset);
    this.bytes.fill(0, this.offset + data.byteLength, this.offset + padded);
    this.offset += padded;
    return this;
  }

  raw(data: Uint8Array): this {
    if (data.byteLength % 4 !== 0) throw new Error('raw data must be word aligned');
    this.ensure(data.byteLength);
    this.bytes.set(data, this.offset);
    this.offset += data.byteLength;
    return this;
  }

  /** Begin a command; returns the header offset to patch with endCommand. */
  protected begin(opcode: number): number {
    const at = this.offset;
    this.u32(opcode);
    return at;
  }

  protected end(headerAt: number): void {
    const words = (this.offset - headerAt - 4) >> 2;
    if (words > 0xffff) throw new Error('command payload too large');
    const opcode = this.view.getUint32(headerAt, true) & 0xffff;
    this.view.setUint32(headerAt, (opcode | (words << 16)) >>> 0, true);
  }

  /** A copy of the written bytes. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }

  reset(): void {
    this.offset = 0;
  }
}

export type Radii = readonly [tl: number, tr: number, br: number, bl: number];
export const NO_RADII: Radii = [0, 0, 0, 0];

/** Writes the drawing commands of one chunk. */
export class CommandWriter extends WordWriter {
  private simple(op: number, ...values: number[]): this {
    const at = this.begin(op);
    for (const v of values) this.f32(v);
    this.end(at);
    return this;
  }

  save(): this { return this.simple(Op.Save); }
  restore(): this { return this.simple(Op.Restore); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.simple(Op.Transform, a, b, c, d, e, f);
  }
  alpha(value: number): this { return this.simple(Op.Alpha, value); }
  clipRect(x: number, y: number, w: number, h: number): this { return this.simple(Op.ClipRect, x, y, w, h); }
  clipRRect(x: number, y: number, w: number, h: number, r: Radii): this {
    return this.simple(Op.ClipRRect, x, y, w, h, r[0], r[1], r[2], r[3]);
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): this {
    const at = this.begin(Op.FillRect);
    this.f32(x).f32(y).f32(w).f32(h).u32(color);
    this.end(at);
    return this;
  }

  fillRRect(x: number, y: number, w: number, h: number, r: Radii, color: number): this {
    const at = this.begin(Op.FillRRect);
    this.f32(x).f32(y).f32(w).f32(h).f32(r[0]).f32(r[1]).f32(r[2]).f32(r[3]).u32(color);
    this.end(at);
    return this;
  }

  strokeRRect(x: number, y: number, w: number, h: number, r: Radii, lineWidth: number, color: number, dash = 0): this {
    const at = this.begin(Op.StrokeRRect);
    this.f32(x).f32(y).f32(w).f32(h).f32(r[0]).f32(r[1]).f32(r[2]).f32(r[3]).f32(lineWidth).u32(color).u32(dash);
    this.end(at);
    return this;
  }

  fillRing(
    ox: number, oy: number, ow: number, oh: number, or: Radii,
    ix: number, iy: number, iw: number, ih: number, ir: Radii,
    color: number,
  ): this {
    const at = this.begin(Op.FillRing);
    this.f32(ox).f32(oy).f32(ow).f32(oh).f32(or[0]).f32(or[1]).f32(or[2]).f32(or[3]);
    this.f32(ix).f32(iy).f32(iw).f32(ih).f32(ir[0]).f32(ir[1]).f32(ir[2]).f32(ir[3]);
    this.u32(color);
    this.end(at);
    return this;
  }

  shadow(color: number, blur: number, dx: number, dy: number): this {
    const at = this.begin(Op.Shadow);
    this.u32(color).f32(blur).f32(dx).f32(dy);
    this.end(at);
    return this;
  }
  shadowClear(): this { return this.simple(Op.ShadowClear); }

  linearGradientRRect(
    x: number, y: number, w: number, h: number, r: Radii,
    x0: number, y0: number, x1: number, y1: number,
    stops: ReadonlyArray<readonly [offset: number, color: number]>,
  ): this {
    const at = this.begin(Op.LinearGradientRRect);
    this.f32(x).f32(y).f32(w).f32(h).f32(r[0]).f32(r[1]).f32(r[2]).f32(r[3]);
    this.f32(x0).f32(y0).f32(x1).f32(y1).u32(stops.length);
    for (const [offset, color] of stops) this.f32(offset).u32(color);
    this.end(at);
    return this;
  }

  boxShadow(
    x: number, y: number, w: number, h: number, r: Radii,
    color: number, blur: number, dx: number, dy: number, spread: number, inset: boolean,
  ): this {
    const at = this.begin(Op.BoxShadow);
    this.f32(x).f32(y).f32(w).f32(h).f32(r[0]).f32(r[1]).f32(r[2]).f32(r[3]);
    this.u32(color).f32(blur).f32(dx).f32(dy).f32(spread).u32(inset ? 1 : 0);
    this.end(at);
    return this;
  }

  pathBegin(): this { return this.simple(Op.PathBegin); }
  moveTo(x: number, y: number): this { return this.simple(Op.MoveTo, x, y); }
  lineTo(x: number, y: number): this { return this.simple(Op.LineTo, x, y); }
  quadTo(cx: number, cy: number, x: number, y: number): this { return this.simple(Op.QuadTo, cx, cy, x, y); }
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    return this.simple(Op.CubicTo, c1x, c1y, c2x, c2y, x, y);
  }
  arc(cx: number, cy: number, r: number, start: number, end: number, ccw = false): this {
    const at = this.begin(Op.Arc);
    this.f32(cx).f32(cy).f32(r).f32(start).f32(end).u32(ccw ? 1 : 0);
    this.end(at);
    return this;
  }
  closePath(): this { return this.simple(Op.ClosePath); }
  fillPath(color: number, rule = 0): this {
    const at = this.begin(Op.FillPath);
    this.u32(color).u32(rule);
    this.end(at);
    return this;
  }
  strokePath(color: number, lineWidth: number, cap = 0, join = 0): this {
    const at = this.begin(Op.StrokePath);
    this.u32(color).f32(lineWidth).u32(cap).u32(join);
    this.end(at);
    return this;
  }
  clipPath(rule = 0): this {
    const at = this.begin(Op.ClipPath);
    this.u32(rule);
    this.end(at);
    return this;
  }

  font(css: string): this {
    const at = this.begin(Op.Font);
    this.string(css);
    this.end(at);
    return this;
  }

  text(x: number, baseline: number, color: number, letterSpacing: number, value: string): this {
    const at = this.begin(Op.Text);
    this.f32(x).f32(baseline).u32(color).f32(letterSpacing).string(value);
    this.end(at);
    return this;
  }

  image(
    dx: number, dy: number, dw: number, dh: number,
    sx: number, sy: number, sw: number, sh: number,
    tint: number, uri: string,
  ): this {
    const at = this.begin(Op.Image);
    this.f32(dx).f32(dy).f32(dw).f32(dh).f32(sx).f32(sy).f32(sw).f32(sh).u32(tint).string(uri);
    this.end(at);
    return this;
  }
}

export interface ClipSpec {
  kind: 0 | 1 | 2;
  x: number; y: number; w: number; h: number;
  radii: Radii;
}

export const NO_CLIP: ClipSpec = { kind: 0, x: 0, y: 0, w: 0, h: 0, radii: NO_RADII };

/** Writes the composition (layer tree) of a frame. */
export class CompositeWriter extends WordWriter {
  push(layerId: number, m: readonly number[], opacity: number, clip: ClipSpec): this {
    const at = this.begin(CompositeOp.Push);
    this.u32(layerId);
    for (let i = 0; i < 6; i++) this.f32(m[i]!);
    this.f32(opacity).u32(clip.kind).f32(clip.x).f32(clip.y).f32(clip.w).f32(clip.h);
    this.f32(clip.radii[0]).f32(clip.radii[1]).f32(clip.radii[2]).f32(clip.radii[3]);
    this.end(at);
    return this;
  }
  chunk(index: number): this {
    const at = this.begin(CompositeOp.Chunk);
    this.u32(index);
    this.end(at);
    return this;
  }
  pop(): this {
    const at = this.begin(CompositeOp.Pop);
    this.end(at);
    return this;
  }
}
