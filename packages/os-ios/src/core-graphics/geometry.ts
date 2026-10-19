import { IDENTITY, invert, multiply, rotation, scaling, translation, type Matrix } from '@mimicry/os-core';

/**
 * Core Graphics geometry: CGPoint, CGSize, CGRect, CGAffineTransform and
 * UIKit's UIEdgeInsets, with the C functions apps call (CGRectMake,
 * CGRectGetMaxX…). Structs are plain objects; transforms use Core Graphics'
 * field names (a b c d tx ty).
 */
export interface CGPoint {
  x: number;
  y: number;
}

export interface CGSize {
  width: number;
  height: number;
}

export interface CGRect {
  origin: CGPoint;
  size: CGSize;
}

export interface CGAffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface UIEdgeInsets {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export const CGPointZero: Readonly<CGPoint> = Object.freeze({ x: 0, y: 0 });
export const CGSizeZero: Readonly<CGSize> = Object.freeze({ width: 0, height: 0 });
export const CGRectZero: Readonly<CGRect> = Object.freeze({ origin: CGPointZero, size: CGSizeZero });
export const UIEdgeInsetsZero: Readonly<UIEdgeInsets> = Object.freeze({ top: 0, left: 0, bottom: 0, right: 0 });
export const CGAffineTransformIdentity: Readonly<CGAffineTransform> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

export const CGPointMake = (x: number, y: number): CGPoint => ({ x, y });
export const CGSizeMake = (width: number, height: number): CGSize => ({ width, height });
export const CGRectMake = (x: number, y: number, width: number, height: number): CGRect => ({ origin: { x, y }, size: { width, height } });
export const UIEdgeInsetsMake = (top: number, left: number, bottom: number, right: number): UIEdgeInsets => ({ top, left, bottom, right });

export const CGRectGetMinX = (r: CGRect) => Math.min(r.origin.x, r.origin.x + r.size.width);
export const CGRectGetMinY = (r: CGRect) => Math.min(r.origin.y, r.origin.y + r.size.height);
export const CGRectGetMaxX = (r: CGRect) => Math.max(r.origin.x, r.origin.x + r.size.width);
export const CGRectGetMaxY = (r: CGRect) => Math.max(r.origin.y, r.origin.y + r.size.height);
export const CGRectGetMidX = (r: CGRect) => r.origin.x + r.size.width / 2;
export const CGRectGetMidY = (r: CGRect) => r.origin.y + r.size.height / 2;
export const CGRectGetWidth = (r: CGRect) => Math.abs(r.size.width);
export const CGRectGetHeight = (r: CGRect) => Math.abs(r.size.height);
export const CGRectContainsPoint = (r: CGRect, p: CGPoint) =>
  p.x >= CGRectGetMinX(r) && p.x < CGRectGetMaxX(r) && p.y >= CGRectGetMinY(r) && p.y < CGRectGetMaxY(r);
export const CGRectInset = (r: CGRect, dx: number, dy: number): CGRect =>
  CGRectMake(r.origin.x + dx, r.origin.y + dy, r.size.width - dx * 2, r.size.height - dy * 2);
export const CGRectEqualToRect = (a: CGRect, b: CGRect) =>
  a.origin.x === b.origin.x && a.origin.y === b.origin.y && a.size.width === b.size.width && a.size.height === b.size.height;
export const UIEdgeInsetsInsetRect = (r: CGRect, i: UIEdgeInsets): CGRect =>
  CGRectMake(r.origin.x + i.left, r.origin.y + i.top, r.size.width - i.left - i.right, r.size.height - i.top - i.bottom);
export const UIEdgeInsetsEqualToEdgeInsets = (a: UIEdgeInsets, b: UIEdgeInsets) =>
  a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;

export const CGAffineTransformMake = (a: number, b: number, c: number, d: number, tx: number, ty: number): CGAffineTransform => ({ a, b, c, d, tx, ty });
export const CGAffineTransformMakeTranslation = (tx: number, ty: number) => fromMatrix(translation(tx, ty));
export const CGAffineTransformMakeScale = (sx: number, sy: number) => fromMatrix(scaling(sx, sy));
export const CGAffineTransformMakeRotation = (angle: number) => fromMatrix(rotation(angle));
export const CGAffineTransformTranslate = (t: CGAffineTransform, tx: number, ty: number) => fromMatrix(multiply(toMatrix(t), translation(tx, ty)));
export const CGAffineTransformScale = (t: CGAffineTransform, sx: number, sy: number) => fromMatrix(multiply(toMatrix(t), scaling(sx, sy)));
export const CGAffineTransformRotate = (t: CGAffineTransform, angle: number) => fromMatrix(multiply(toMatrix(t), rotation(angle)));
/** t1 then t2 */
export const CGAffineTransformConcat = (t1: CGAffineTransform, t2: CGAffineTransform) => fromMatrix(multiply(toMatrix(t2), toMatrix(t1)));
export const CGAffineTransformInvert = (t: CGAffineTransform) => {
  const m = invert(toMatrix(t));
  return m ? fromMatrix(m) : t;
};
export const CGAffineTransformIsIdentity = (t: CGAffineTransform) =>
  t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.tx === 0 && t.ty === 0;
export const CGPointApplyAffineTransform = (p: CGPoint, t: CGAffineTransform): CGPoint => ({
  x: t.a * p.x + t.c * p.y + t.tx,
  y: t.b * p.x + t.d * p.y + t.ty,
});

export function toMatrix(t: CGAffineTransform): Matrix {
  return [t.a, t.b, t.c, t.d, t.tx, t.ty];
}

export function fromMatrix(m: Readonly<Matrix>): CGAffineTransform {
  return { a: m[0], b: m[1], c: m[2], d: m[3], tx: m[4], ty: m[5] };
}

export { IDENTITY };
