import { IDENTITY, apply, invert, multiply, type Matrix as Affine } from '@mimicry/os-core';
import { RectF } from './canvas';

/**
 * android.graphics.Matrix, affine only (the render tree is 2D, so the
 * perspective row stays 0 0 1). pre* operations apply before the current
 * matrix (M' = M · S), post* after it (M' = S · M), as in the framework.
 */
export enum ScaleToFit {
  FILL = 0,
  START = 1,
  CENTER = 2,
  END = 3,
}

export class Matrix {
  static readonly MSCALE_X = 0;
  static readonly MSKEW_X = 1;
  static readonly MTRANS_X = 2;
  static readonly MSKEW_Y = 3;
  static readonly MSCALE_Y = 4;
  static readonly MTRANS_Y = 5;
  static readonly MPERSP_0 = 6;
  static readonly MPERSP_1 = 7;
  static readonly MPERSP_2 = 8;
  static readonly ScaleToFit = ScaleToFit;

  /** [a, b, c, d, e, f] in Canvas order */
  private m: Affine = IDENTITY.slice() as Affine;

  constructor(src?: Matrix) {
    if (src) this.m = src.m.slice() as Affine;
  }

  /** @internal the affine values */
  get affine(): Affine {
    return this.m.slice() as Affine;
  }

  /** @internal */
  static fromAffine(m: Affine): Matrix {
    const out = new Matrix();
    out.m = m.slice() as Affine;
    return out;
  }

  reset(): void {
    this.m = IDENTITY.slice() as Affine;
  }

  set(src: Matrix | null): void {
    this.m = src ? (src.m.slice() as Affine) : (IDENTITY.slice() as Affine);
  }

  isIdentity(): boolean {
    const m = this.m;
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
  }

  isAffine(): boolean {
    return true;
  }

  rectStaysRect(): boolean {
    const m = this.m;
    return (m[1] === 0 && m[2] === 0) || (m[0] === 0 && m[3] === 0);
  }

  setTranslate(dx: number, dy: number): void {
    this.m = [1, 0, 0, 1, dx, dy];
  }

  setScale(sx: number, sy: number, px = 0, py = 0): void {
    this.m = [sx, 0, 0, sy, px - sx * px, py - sy * py];
  }

  setRotate(degrees: number, px = 0, py = 0): void {
    const r = (degrees * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    this.m = [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
  }

  setSkew(kx: number, ky: number, px = 0, py = 0): void {
    this.m = [1, ky, kx, 1, -kx * py, -ky * px];
  }

  setConcat(a: Matrix, b: Matrix): boolean {
    this.m = multiply(a.m, b.m);
    return true;
  }

  private pre(other: Affine): boolean {
    this.m = multiply(this.m, other);
    return true;
  }

  private post(other: Affine): boolean {
    this.m = multiply(other, this.m);
    return true;
  }

  preTranslate(dx: number, dy: number): boolean { return this.pre([1, 0, 0, 1, dx, dy]); }
  postTranslate(dx: number, dy: number): boolean { return this.post([1, 0, 0, 1, dx, dy]); }

  preScale(sx: number, sy: number, px = 0, py = 0): boolean {
    const s = new Matrix();
    s.setScale(sx, sy, px, py);
    return this.pre(s.m);
  }

  postScale(sx: number, sy: number, px = 0, py = 0): boolean {
    const s = new Matrix();
    s.setScale(sx, sy, px, py);
    return this.post(s.m);
  }

  preRotate(degrees: number, px = 0, py = 0): boolean {
    const r = new Matrix();
    r.setRotate(degrees, px, py);
    return this.pre(r.m);
  }

  postRotate(degrees: number, px = 0, py = 0): boolean {
    const r = new Matrix();
    r.setRotate(degrees, px, py);
    return this.post(r.m);
  }

  preConcat(other: Matrix): boolean { return this.pre(other.m); }
  postConcat(other: Matrix): boolean { return this.post(other.m); }

  invert(inverse: Matrix): boolean {
    const inv = invert(this.m);
    if (!inv) return false;
    inverse.m = inv;
    return true;
  }

  /** Map `src` onto `dst` with scale and translation only. */
  setRectToRect(src: RectF, dst: RectF, stf: ScaleToFit): boolean {
    const sw = src.width();
    const sh = src.height();
    if (sw <= 0 || sh <= 0) {
      this.reset();
      return false;
    }
    let sx = dst.width() / sw;
    let sy = dst.height() / sh;
    let tx = dst.left - src.left * sx;
    let ty = dst.top - src.top * sy;
    if (stf !== ScaleToFit.FILL) {
      const s = Math.min(sx, sy);
      sx = sy = s;
      tx = dst.left - src.left * s;
      ty = dst.top - src.top * s;
      const diffX = dst.width() - sw * s;
      const diffY = dst.height() - sh * s;
      if (stf === ScaleToFit.CENTER) {
        tx += diffX / 2;
        ty += diffY / 2;
      } else if (stf === ScaleToFit.END) {
        tx += diffX;
        ty += diffY;
      }
    }
    this.m = [sx, 0, 0, sy, tx, ty];
    return true;
  }

  mapPoints(pts: number[]): void {
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const [x, y] = apply(this.m, pts[i]!, pts[i + 1]!);
      pts[i] = x;
      pts[i + 1] = y;
    }
  }

  /** Map `rect` in place to the bounds of its transformed corners; true when it stays a rectangle. */
  mapRect(rect: RectF): boolean {
    const pts = [rect.left, rect.top, rect.right, rect.top, rect.right, rect.bottom, rect.left, rect.bottom];
    this.mapPoints(pts);
    const xs = [pts[0]!, pts[2]!, pts[4]!, pts[6]!];
    const ys = [pts[1]!, pts[3]!, pts[5]!, pts[7]!];
    rect.set(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    return this.rectStaysRect();
  }

  /** The nine values in row-major order (MSCALE_X … MPERSP_2). */
  getValues(values: number[] = new Array(9)): number[] {
    const m = this.m;
    values[0] = m[0];
    values[1] = m[2];
    values[2] = m[4];
    values[3] = m[1];
    values[4] = m[3];
    values[5] = m[5];
    values[6] = 0;
    values[7] = 0;
    values[8] = 1;
    return values;
  }

  setValues(values: number[]): void {
    this.m = [values[0] ?? 1, values[3] ?? 0, values[1] ?? 0, values[4] ?? 1, values[2] ?? 0, values[5] ?? 0];
  }

  equals(other: Matrix | null): boolean {
    return !!other && this.m.every((v, i) => Math.abs(v - other.m[i]!) < 1e-6);
  }

  toString(): string {
    const v = this.getValues();
    return `Matrix{[${v.slice(0, 3).join(', ')}][${v.slice(3, 6).join(', ')}][0, 0, 1]}`;
  }
}
