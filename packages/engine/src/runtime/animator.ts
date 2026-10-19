/**
 * Per-frame work. Everything that "reads something live this frame" —
 * Animated values, scroll momentum, control transitions, spinners — is an
 * entry here. While the set is non-empty the engine keeps requesting
 * frames; when it empties, the engine goes idle and stops painting.
 */
export interface FrameTask {
  /** return true to keep running next frame */
  tick(animationTime: number, frameTime: number): boolean;
}

export class Animator {
  private readonly tasks = new Set<FrameTask>();
  private callbacks = new Map<number, (time: number) => void>();
  private nextCallback = 1;
  private lastFrame: number | null = null;
  /** animation time can run slower than wall time ("slow animations") */
  animationTime = 0;
  timeScale = 1;

  add(task: FrameTask): void {
    this.tasks.add(task);
  }

  remove(task: FrameTask): void {
    this.tasks.delete(task);
  }

  has(task: FrameTask): boolean {
    return this.tasks.has(task);
  }

  requestAnimationFrame(cb: (time: number) => void): number {
    const id = this.nextCallback++;
    this.callbacks.set(id, cb);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.callbacks.delete(id);
  }

  get busy(): boolean {
    return this.tasks.size > 0 || this.callbacks.size > 0;
  }

  get liveCount(): number {
    return this.tasks.size;
  }

  /** Advance animation time to match a frame at `frameTime`. */
  advanceTo(frameTime: number): void {
    if (this.lastFrame === null) this.lastFrame = frameTime;
    const delta = Math.max(0, Math.min(frameTime - this.lastFrame, 250));
    this.lastFrame = frameTime;
    this.animationTime += delta / this.timeScale;
  }

  /** Run rAF callbacks (app code) for this frame. */
  runCallbacks(frameTime: number, run: (fn: () => void) => void): void {
    if (!this.callbacks.size) return;
    const callbacks = this.callbacks;
    this.callbacks = new Map();
    for (const cb of callbacks.values()) run(() => cb(frameTime));
  }

  /** Step frame tasks. */
  step(frameTime: number): void {
    for (const task of Array.from(this.tasks)) {
      let keep = false;
      try {
        keep = task.tick(this.animationTime, frameTime);
      } catch (error) {
        console.error(error);
      }
      if (!keep) this.tasks.delete(task);
    }
  }
}

// ── easing & springs shared by engine-side animations ─────────────────────

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Cubic bezier easing (CSS timing functions, UIKit's default curves). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(t);
  };
}

/** UIKit's default easeInEaseOut curve. */
export const uikitEase = cubicBezier(0.42, 0, 0.58, 1);
/** Material standard easing. */
export const materialStandard = cubicBezier(0.2, 0, 0, 1);

/** Damped spring integrator (semi-implicit Euler, fixed 1ms substeps). */
export class Spring {
  position: number;
  velocity: number;
  constructor(
    from: number,
    public target: number,
    velocity = 0,
    public stiffness = 300,
    public damping = 2 * Math.sqrt(300),
    public mass = 1,
  ) {
    this.position = from;
    this.velocity = velocity;
  }

  /** advance by dt milliseconds; returns true when at rest */
  step(dtMs: number): boolean {
    const steps = Math.max(1, Math.ceil(dtMs));
    const dt = dtMs / steps / 1000;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.position - this.target) - this.damping * this.velocity;
      this.velocity += (force / this.mass) * dt;
      this.position += this.velocity * dt;
    }
    if (Math.abs(this.position - this.target) < 0.01 && Math.abs(this.velocity) < 0.05) {
      this.position = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}
