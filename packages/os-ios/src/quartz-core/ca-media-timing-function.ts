import { cubicBezier } from '@mimicry/os-core';

/**
 * CAMediaTimingFunction: a cubic Bézier from (0,0) to (1,1) that maps an
 * animation's elapsed fraction to its progress. The named functions carry
 * Core Animation's own control points (`default` is the curve implicit
 * layer actions use; `easeInEaseOut` is UIKit's curveEaseInOut).
 */
export enum CAMediaTimingFunctionName {
  linear = 'linear',
  easeIn = 'easeIn',
  easeOut = 'easeOut',
  easeInEaseOut = 'easeInEaseOut',
  default = 'default',
}

const NAMED: Record<CAMediaTimingFunctionName, [number, number, number, number]> = {
  [CAMediaTimingFunctionName.linear]: [0, 0, 1, 1],
  [CAMediaTimingFunctionName.easeIn]: [0.42, 0, 1, 1],
  [CAMediaTimingFunctionName.easeOut]: [0, 0, 0.58, 1],
  [CAMediaTimingFunctionName.easeInEaseOut]: [0.42, 0, 0.58, 1],
  [CAMediaTimingFunctionName.default]: [0.25, 0.1, 0.25, 1],
};

export class CAMediaTimingFunction {
  private readonly points: [number, number, number, number];
  private readonly curve: (t: number) => number;

  /** CAMediaTimingFunction(name:) */
  constructor(name: CAMediaTimingFunctionName);
  /** CAMediaTimingFunction(controlPoints:_:_:_:) */
  constructor(c1x: number, c1y: number, c2x: number, c2y: number);
  constructor(nameOrX: CAMediaTimingFunctionName | number, c1y = 0, c2x = 1, c2y = 1) {
    this.points = typeof nameOrX === 'number' ? [nameOrX, c1y, c2x, c2y] : [...NAMED[nameOrX]];
    const [a, b, c, d] = this.points;
    this.curve = a === 0 && b === 0 && c === 1 && d === 1 ? (t) => t : cubicBezier(a, b, c, d);
  }

  /** getControlPoint(at:values:) — index 0…3; 0 is (0,0) and 3 is (1,1). */
  getControlPoint(index: number): [number, number] {
    switch (index) {
      case 0: return [0, 0];
      case 1: return [this.points[0], this.points[1]];
      case 2: return [this.points[2], this.points[3]];
      default: return [1, 1];
    }
  }

  /** Mimicry: progress at an elapsed fraction (what the render server evaluates). */
  evaluate(fraction: number): number {
    return this.curve(fraction);
  }

  static readonly linear = new CAMediaTimingFunction(CAMediaTimingFunctionName.linear);
  static readonly easeIn = new CAMediaTimingFunction(CAMediaTimingFunctionName.easeIn);
  static readonly easeOut = new CAMediaTimingFunction(CAMediaTimingFunctionName.easeOut);
  static readonly easeInEaseOut = new CAMediaTimingFunction(CAMediaTimingFunctionName.easeInEaseOut);
  static readonly default = new CAMediaTimingFunction(CAMediaTimingFunctionName.default);
}
