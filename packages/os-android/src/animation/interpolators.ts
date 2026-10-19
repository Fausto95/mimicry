import { Path } from '../graphics/canvas';

/**
 * android.animation.TimeInterpolator and the android.view.animation
 * interpolators, androidx.interpolator's FastOutSlowIn family and the
 * Material 3 motion tokens (com.google.android.material.motion): easing
 * curves and durations.
 *
 * The formulas are the framework's own, so an animation lands on the same
 * values frame for frame.
 */
export interface TimeInterpolator {
  getInterpolation(input: number): number;
}

/** android.view.animation.Interpolator (a TimeInterpolator) */
export type Interpolator = TimeInterpolator;

export class LinearInterpolator implements TimeInterpolator {
  getInterpolation(input: number): number {
    return input;
  }
}

/** ValueAnimator's default: starts and ends slowly (a half cosine). */
export class AccelerateDecelerateInterpolator implements TimeInterpolator {
  getInterpolation(input: number): number {
    return Math.cos((input + 1) * Math.PI) / 2 + 0.5;
  }
}

export class AccelerateInterpolator implements TimeInterpolator {
  private readonly doubleFactor: number;
  constructor(private readonly factor = 1) {
    this.doubleFactor = 2 * factor;
  }
  getInterpolation(input: number): number {
    return this.factor === 1 ? input * input : Math.pow(input, this.doubleFactor);
  }
}

export class DecelerateInterpolator implements TimeInterpolator {
  constructor(private readonly factor = 1) {}
  getInterpolation(input: number): number {
    return this.factor === 1 ? 1 - (1 - input) * (1 - input) : 1 - Math.pow(1 - input, 2 * this.factor);
  }
}

export class OvershootInterpolator implements TimeInterpolator {
  constructor(private readonly tension = 2) {}
  getInterpolation(input: number): number {
    const t = input - 1;
    return t * t * ((this.tension + 1) * t + this.tension) + 1;
  }
}

export class AnticipateInterpolator implements TimeInterpolator {
  constructor(private readonly tension = 2) {}
  getInterpolation(t: number): number {
    return t * t * ((this.tension + 1) * t - this.tension);
  }
}

export class AnticipateOvershootInterpolator implements TimeInterpolator {
  private readonly tension: number;
  constructor(tension = 2, extraTension = 1.5) {
    this.tension = tension * extraTension;
  }
  getInterpolation(t: number): number {
    const a = (t: number, s: number) => t * t * ((s + 1) * t - s);
    const o = (t: number, s: number) => t * t * ((s + 1) * t + s);
    return t < 0.5 ? 0.5 * a(t * 2, this.tension) : 0.5 * (o(t * 2 - 2, this.tension) + 2);
  }
}

export class BounceInterpolator implements TimeInterpolator {
  getInterpolation(input: number): number {
    const bounce = (t: number) => t * t * 8;
    const t = input * 1.1226;
    if (t < 0.3535) return bounce(t);
    if (t < 0.7408) return bounce(t - 0.54719) + 0.7;
    if (t < 0.9644) return bounce(t - 0.8526) + 0.9;
    return bounce(t - 1.0435) + 0.95;
  }
}

export class CycleInterpolator implements TimeInterpolator {
  constructor(private readonly cycles: number) {}
  getInterpolation(input: number): number {
    return Math.sin(2 * this.cycles * Math.PI * input);
  }
}

/**
 * android.view.animation.PathInterpolator: y as a function of x along a
 * path from (0, 0) to (1, 1) — a quadratic or cubic Bézier, or any Path.
 * Like the framework, the path is flattened (precision 0.002) and looked up
 * by binary search on x.
 */
export class PathInterpolator implements TimeInterpolator {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];

  constructor(path: Path);
  constructor(controlX: number, controlY: number);
  constructor(controlX1: number, controlY1: number, controlX2: number, controlY2: number);
  constructor(a: Path | number, b?: number, c?: number, d?: number) {
    let path: Path;
    if (a instanceof Path) path = a;
    else {
      path = new Path();
      path.moveTo(0, 0);
      if (c === undefined || d === undefined) path.quadTo(a, b ?? 0, 1, 1);
      else path.cubicTo(a, b ?? 0, c, d, 1, 1);
    }
    const points = path.approximate(0.002);
    let prevX = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i + 1]!;
      const y = points[i + 2]!;
      if (x < prevX - 1e-6) throw new Error('IllegalArgumentException: The Path cannot loop back on itself.');
      if (x === prevX && this.xs.length) {
        // a vertical step: keep the later y for the same x
        this.ys[this.ys.length - 1] = y;
        continue;
      }
      this.xs.push(x);
      this.ys.push(y);
      prevX = x;
    }
    if (Math.abs(this.xs[0]!) > 1e-6 || Math.abs(this.ys[0]!) > 1e-6 || Math.abs(this.xs[this.xs.length - 1]! - 1) > 1e-6 || Math.abs(this.ys[this.ys.length - 1]! - 1) > 1e-6) {
      throw new Error('IllegalArgumentException: The Path must start at (0,0) and end at (1,1)');
    }
  }

  getInterpolation(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = this.xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t < this.xs[mid]!) hi = mid;
      else lo = mid;
    }
    const range = this.xs[hi]! - this.xs[lo]!;
    if (range === 0) return this.ys[lo]!;
    const f = (t - this.xs[lo]!) / range;
    return this.ys[lo]! + f * (this.ys[hi]! - this.ys[lo]!);
  }
}

/** androidx.interpolator.view.animation.FastOutSlowInInterpolator (Material's standard curve until M3). */
export class FastOutSlowInInterpolator extends PathInterpolator {
  constructor() {
    super(0.4, 0, 0.2, 1);
  }
}

/** androidx LinearOutSlowInInterpolator: entering elements. */
export class LinearOutSlowInInterpolator extends PathInterpolator {
  constructor() {
    super(0, 0, 0.2, 1);
  }
}

/** androidx FastOutLinearInInterpolator: exiting elements. */
export class FastOutLinearInInterpolator extends PathInterpolator {
  constructor() {
    super(0.4, 0, 1, 1);
  }
}

/** The M3 emphasized curve: two cubics, fast out of the gate and a long gentle landing. */
function emphasizedPath(): Path {
  const p = new Path();
  p.moveTo(0, 0);
  p.cubicTo(0.05, 0, 0.133333, 0.06, 0.166666, 0.4);
  p.cubicTo(0.208333, 0.82, 0.25, 1, 1, 1);
  return p;
}

/**
 * Material 3 motion tokens (`?attr/motionEasing*`, `?attr/motionDuration*`,
 * MotionUtils). Easings are shared instances; durations are milliseconds.
 */
export const MaterialMotion = {
  easing: {
    emphasized: new PathInterpolator(emphasizedPath()),
    emphasizedDecelerate: new PathInterpolator(0.05, 0.7, 0.1, 1),
    emphasizedAccelerate: new PathInterpolator(0.3, 0, 0.8, 0.15),
    standard: new PathInterpolator(0.2, 0, 0, 1),
    standardDecelerate: new PathInterpolator(0, 0, 0, 1),
    standardAccelerate: new PathInterpolator(0.3, 0, 1, 1),
    legacy: new PathInterpolator(0.4, 0, 0.2, 1),
    legacyDecelerate: new PathInterpolator(0, 0, 0.2, 1),
    legacyAccelerate: new PathInterpolator(0.4, 0, 1, 1),
    linear: new LinearInterpolator(),
  },
  duration: {
    short1: 50, short2: 100, short3: 150, short4: 200,
    medium1: 250, medium2: 300, medium3: 350, medium4: 400,
    long1: 450, long2: 500, long3: 550, long4: 600,
    extraLong1: 700, extraLong2: 800, extraLong3: 900, extraLong4: 1000,
  },
} as const;

/** com.google.android.material.animation.AnimationUtils' shared interpolators. */
export const AnimationUtils = {
  LINEAR_INTERPOLATOR: new LinearInterpolator() as TimeInterpolator,
  FAST_OUT_SLOW_IN_INTERPOLATOR: new FastOutSlowInInterpolator() as TimeInterpolator,
  FAST_OUT_LINEAR_IN_INTERPOLATOR: new FastOutLinearInInterpolator() as TimeInterpolator,
  LINEAR_OUT_SLOW_IN_INTERPOLATOR: new LinearOutSlowInInterpolator() as TimeInterpolator,
  DECELERATE_INTERPOLATOR: new DecelerateInterpolator() as TimeInterpolator,
  lerp(start: number, end: number, fraction: number): number {
    return start + fraction * (end - start);
  },
};
