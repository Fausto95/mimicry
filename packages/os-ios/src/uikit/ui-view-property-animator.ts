import type { FrameTask, Kernel, Matrix } from '@mimicry/os-core';
import { keyPathSpec, packColor, subtractValues, zeroValue } from '../quartz-core/animatable';
import { CABasicAnimation } from '../quartz-core/ca-animation';
import type { CALayer } from '../quartz-core/ca-layer';
import { CAEnvironment, mainQueueAsync, mediaNow } from '../quartz-core/ca-media-time';
import { CAMediaTimingFunction } from '../quartz-core/ca-media-timing-function';
import { dampingRatioSpring, perceptualSpring, springProgress, springSettlingDuration, type SpringParameters } from '../quartz-core/spring';
import { fromMatrix, type CGPoint } from '../core-graphics/geometry';
import { UIColor } from './ui-color';
import type { UIView } from './ui-view';
import { AnimationBlock, UIViewAnimationCurve, recordInto, timingFunctionFor, withoutAnimation } from './ui-view-animation';

/**
 * UIViewPropertyAnimator (UIViewAnimating, UIViewImplicitlyAnimating):
 * view animations you can start, pause, scrub, reverse, stop and finish.
 *
 * Like UIView.animate, the animations block changes the model at once and
 * every change becomes an additive layer animation; here the animator owns
 * their clock. Its progress follows the timing parameters (a cubic curve,
 * or a spring that may overshoot) as `fractionComplete` (time) runs from 0
 * to 1 — or back, when reversed. Scrubbing while paused moves progress
 * linearly (`scrubsLinearly`); resuming continues along the curve from
 * there. Completions run on the main queue with the position it ended at.
 */
export enum UIViewAnimatingState { inactive = 0, active = 1, stopped = 2 }
export enum UIViewAnimatingPosition { end = 0, start = 1, current = 2 }
export enum UITimingCurveType { builtin = 0, cubic = 1, spring = 2, composed = 3 }

export interface CGVector {
  dx: number;
  dy: number;
}

/** A timing curve over normalized time; springs may overshoot 1. */
export interface UITimingCurveProvider {
  readonly timingCurveType: UITimingCurveType;
  /** @internal progress at a time fraction of an animation lasting `duration` seconds */
  _progress(fraction: number, duration: number): number;
  /** @internal how long the animation runs given the animator's duration */
  _duration(requested: number): number;
}

export class UICubicTimingParameters implements UITimingCurveProvider {
  readonly animationCurve: UIViewAnimationCurve;
  readonly controlPoint1: CGPoint;
  readonly controlPoint2: CGPoint;
  private readonly fn: CAMediaTimingFunction;

  /** UICubicTimingParameters() / (animationCurve:) / (controlPoint1:controlPoint2:) */
  constructor(curve?: UIViewAnimationCurve);
  constructor(controlPoint1: CGPoint, controlPoint2: CGPoint);
  constructor(a: UIViewAnimationCurve | CGPoint = UIViewAnimationCurve.easeInOut, b?: CGPoint) {
    if (typeof a === 'object') {
      this.animationCurve = UIViewAnimationCurve.easeInOut;
      this.controlPoint1 = a;
      this.controlPoint2 = b ?? { x: 1, y: 1 };
      this.fn = new CAMediaTimingFunction(a.x, a.y, this.controlPoint2.x, this.controlPoint2.y);
    } else {
      this.animationCurve = a;
      this.fn = timingFunctionFor(a);
      const [x1, y1] = this.fn.getControlPoint(1);
      const [x2, y2] = this.fn.getControlPoint(2);
      this.controlPoint1 = { x: x1, y: y1 };
      this.controlPoint2 = { x: x2, y: y2 };
    }
  }

  get timingCurveType(): UITimingCurveType {
    return UITimingCurveType.cubic;
  }

  _progress(fraction: number): number {
    return this.fn.evaluate(Math.max(0, Math.min(1, fraction)));
  }

  _duration(requested: number): number {
    return requested;
  }
}

export class UISpringTimingParameters implements UITimingCurveProvider {
  readonly initialVelocity: CGVector;
  /** set when the spring was given as a damping ratio (its stiffness then fits the animator's duration) */
  readonly dampingRatio: number | null;
  private readonly physical: SpringParameters | null;

  /**
   * (dampingRatio:initialVelocity:) — a number
   * (mass:stiffness:damping:initialVelocity:) — the animator's duration is ignored
   * iOS 17 (duration:bounce:initialVelocity:) — likewise
   */
  constructor(dampingRatio?: number, initialVelocity?: CGVector);
  constructor(spring: { mass: number; stiffness: number; damping: number; initialVelocity?: CGVector });
  constructor(spring: { duration: number; bounce: number; initialVelocity?: CGVector });
  constructor(
    a: number | { mass: number; stiffness: number; damping: number; initialVelocity?: CGVector } | { duration: number; bounce: number; initialVelocity?: CGVector } = 1,
    velocity: CGVector = { dx: 0, dy: 0 },
  ) {
    if (typeof a === 'number') {
      this.dampingRatio = a;
      this.initialVelocity = velocity;
      this.physical = null;
    } else if ('mass' in a) {
      this.dampingRatio = null;
      this.initialVelocity = a.initialVelocity ?? { dx: 0, dy: 0 };
      this.physical = { mass: a.mass, stiffness: a.stiffness, damping: a.damping, initialVelocity: this.initialVelocity.dx };
    } else {
      this.dampingRatio = null;
      this.initialVelocity = a.initialVelocity ?? { dx: 0, dy: 0 };
      this.physical = perceptualSpring(a.duration, a.bounce, this.initialVelocity.dx);
    }
  }

  get timingCurveType(): UITimingCurveType {
    return UITimingCurveType.spring;
  }

  private spring(duration: number): SpringParameters {
    return this.physical ?? dampingRatioSpring(duration, this.dampingRatio ?? 1, this.initialVelocity.dx);
  }

  _progress(fraction: number, duration: number): number {
    return springProgress(this.spring(duration), fraction * duration);
  }

  _duration(requested: number): number {
    return this.physical ? springSettlingDuration(this.physical) : requested;
  }
}

/** A stretch of progress: from (f0, p0) to (f1, p1) along the timing curve. */
interface Segment {
  f0: number;
  p0: number;
  f1: number;
  p1: number;
}

interface Group {
  /** progress at which the group's animations start (added mid-flight or with a delay factor) */
  start: number;
  animations: Array<{ view: UIView | null; layer: CALayer; key: string; animationKey: string; from: number[]; to: number[] }>;
}

let animatorKeys = 0;

/** The progress an animator's layer animations read. */
class DrivenAnimation extends CABasicAnimation {
  source: () => number = () => 0;

  override progress(): number {
    return this.source();
  }
}

export interface UIViewPropertyAnimatorOptions {
  curve?: UIViewAnimationCurve;
  controlPoint1?: CGPoint;
  controlPoint2?: CGPoint;
  dampingRatio?: number;
  timingParameters?: UITimingCurveProvider;
}

export class UIViewPropertyAnimator implements FrameTask {
  readonly duration: number;
  readonly timingParameters: UITimingCurveProvider;
  delay = 0;
  isInterruptible = true;
  isUserInteractionEnabled = true;
  isManualHitTestingEnabled = false;
  scrubsLinearly = true;
  pausesOnCompletion = false;
  private _state = UIViewAnimatingState.inactive;
  private _isRunning = false;
  private _isReversed = false;
  /** time fraction, 0…1 */
  private fraction = 0;
  private segment: Segment = { f0: 0, p0: 0, f1: 1, p1: 1 };
  private readonly pendingAnimations: Array<{ block: () => void; delayFactor: number }> = [];
  private readonly completions: Array<(position: UIViewAnimatingPosition) => void> = [];
  private readonly groups: Group[] = [];
  private lastTick: number | null = null;
  private startAt: number | null = null;
  private readonly kernel: Kernel | null;

  /**
   * init(duration:curve:animations:), init(duration:controlPoint1:controlPoint2:animations:),
   * init(duration:dampingRatio:animations:), init(duration:timingParameters:) — the labels as an object.
   */
  constructor(duration: number, options: UIViewPropertyAnimatorOptions = {}, animations?: () => void) {
    this.kernel = CAEnvironment.kernel;
    this.duration = duration;
    this.timingParameters = options.timingParameters
      ?? (options.dampingRatio != null ? new UISpringTimingParameters(options.dampingRatio)
        : options.controlPoint1 ? new UICubicTimingParameters(options.controlPoint1, options.controlPoint2 ?? { x: 1, y: 1 })
          : new UICubicTimingParameters(options.curve ?? UIViewAnimationCurve.easeInOut));
    if (animations) this.pendingAnimations.push({ block: animations, delayFactor: 0 });
  }

  /** runningPropertyAnimator(withDuration:delay:options:animations:completion:) */
  static runningPropertyAnimator(
    duration: number,
    delay: number,
    options: number,
    animations: () => void,
    completion?: (position: UIViewAnimatingPosition) => void,
  ): UIViewPropertyAnimator {
    const animator = new UIViewPropertyAnimator(duration, { curve: ((options >> 16) & 3) as UIViewAnimationCurve }, animations);
    animator.isInterruptible = false;
    if (completion) animator.addCompletion(completion);
    animator.startAnimation(delay);
    return animator;
  }

  get state(): UIViewAnimatingState {
    return this._state;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get isReversed(): boolean {
    return this._isReversed;
  }

  set isReversed(reversed: boolean) {
    if (reversed === this._isReversed) return;
    this._isReversed = reversed;
    // Continue from where things are, towards the other end.
    const p = this.progress;
    this.segment = reversed ? { f0: this.fraction, p0: p, f1: 0, p1: 0 } : { f0: this.fraction, p0: p, f1: 1, p1: 1 };
  }

  get fractionComplete(): number {
    return this.fraction;
  }

  set fractionComplete(fraction: number) {
    this.activate();
    this.fraction = Math.max(0, Math.min(1, fraction));
    const p = this.scrubsLinearly ? this.fraction : this.curve(this.fraction);
    this.segment = this._isReversed ? { f0: this.fraction, p0: p, f1: 0, p1: 0 } : { f0: this.fraction, p0: p, f1: 1, p1: 1 };
    this.redraw();
  }

  /** Current progress of the animated values (may overshoot 1 with springs). */
  get progress(): number {
    const s = this.segment;
    if (s.f1 === s.f0) return s.p1;
    const local = (this.fraction - s.f0) / (s.f1 - s.f0);
    return s.p0 + (s.p1 - s.p0) * this.curve(local, Math.abs(s.f1 - s.f0));
  }

  private curve(x: number, span = 1): number {
    const d = this.timingParameters._duration(this.duration) * span;
    return this.timingParameters._progress(Math.max(0, Math.min(1, x)), d);
  }

  private get runDuration(): number {
    return this.timingParameters._duration(this.duration);
  }

  addAnimations(animations: () => void, delayFactor = 0): void {
    if (this._state === UIViewAnimatingState.inactive) {
      this.pendingAnimations.push({ block: animations, delayFactor });
      return;
    }
    if (this._state === UIViewAnimatingState.stopped) throw new Error('UIViewPropertyAnimator.addAnimations: the animator is stopped');
    this.record(animations, delayFactor);
  }

  addCompletion(completion: (position: UIViewAnimatingPosition) => void): void {
    this.completions.push(completion);
  }

  startAnimation(afterDelay = 0): void {
    if (this._state === UIViewAnimatingState.stopped) throw new Error('UIViewPropertyAnimator.startAnimation: the animator is stopped');
    this.activate();
    this.delay = afterDelay;
    this.startAt = afterDelay > 0 ? mediaNow(this.kernel) + afterDelay * 1000 : null;
    this._isRunning = true;
    this.lastTick = null;
    this.schedule();
  }

  pauseAnimation(): void {
    if (this._state === UIViewAnimatingState.stopped) throw new Error('UIViewPropertyAnimator.pauseAnimation: the animator is stopped');
    this.activate();
    this._isRunning = false;
    this.redraw();
  }

  /** continueAnimation(withTimingParameters:durationFactor:) — resumes (new parameters are not adopted mid-flight). */
  continueAnimation(_parameters: UITimingCurveProvider | null = null, _durationFactor = 1): void {
    this.startAnimation();
  }

  /**
   * stopAnimation(_:): leaves the views where they are on screen. Without
   * finishing, the animator goes to `stopped` and waits for finishAnimation(at:).
   */
  stopAnimation(withoutFinishing: boolean): void {
    if (this._state !== UIViewAnimatingState.active) return;
    this._isRunning = false;
    this.settle(UIViewAnimatingPosition.current);
    this._state = withoutFinishing ? UIViewAnimatingState.inactive : UIViewAnimatingState.stopped;
  }

  /** finishAnimation(at:): only after stopAnimation(false); runs the completions. */
  finishAnimation(at: UIViewAnimatingPosition): void {
    if (this._state !== UIViewAnimatingState.stopped) throw new Error('UIViewPropertyAnimator.finishAnimation(at:): call stopAnimation(false) first');
    this.applyPosition(at);
    this._state = UIViewAnimatingState.inactive;
    this.complete(at);
  }

  // ── machinery ─────────────────────────────────────────────────────────

  private activate(): void {
    if (this._state !== UIViewAnimatingState.inactive) return;
    this._state = UIViewAnimatingState.active;
    this.fraction = 0;
    this.segment = { f0: 0, p0: 0, f1: 1, p1: 1 };
    for (const pending of this.pendingAnimations.splice(0)) this.record(pending.block, pending.delayFactor);
  }

  private record(animations: () => void, delayFactor: number): void {
    const block = new AnimationBlock({ kind: 'curve', duration: 1, curve: CAMediaTimingFunction.linear }, 0, 0);
    recordInto(block, animations);
    const p = this.groups.length ? this.progress : 0;
    const group: Group = { start: p + (1 - p) * Math.max(0, Math.min(1, delayFactor)), animations: [] };
    const local = () => {
      const span = 1 - group.start;
      return span <= 0 ? 1 : (this.progress - group.start) / span;
    };
    for (const [layer, byKey] of block.changes) {
      for (const change of byKey.values()) {
        const spec = keyPathSpec(change.key);
        const to = spec.get(layer._modelState());
        const animation = new DrivenAnimation(change.key);
        animation.source = () => Math.max(group.start > 0 ? 0 : -Infinity, local());
        if (spec.kind === 'color') {
          animation.fromValue = packColor(change.from);
        } else {
          animation.isAdditive = true;
          animation.fromValue = subtractValues(spec.kind, change.from, to);
          animation.toValue = zeroValue(spec.kind, to.length);
        }
        animation.speed = 0;
        animation.duration = 1;
        const animationKey = `UIViewPropertyAnimator-${++animatorKeys}`;
        layer.add(animation, animationKey);
        group.animations.push({ view: change.view, layer, key: change.key, animationKey, from: change.from, to });
      }
    }
    this.groups.push(group);
  }

  private schedule(): void {
    if (!this.kernel) return;
    this.kernel.animator.add(this);
    this.kernel.requestFrame();
  }

  tick(): boolean {
    if (!this._isRunning || this._state !== UIViewAnimatingState.active) return false;
    const now = mediaNow(this.kernel);
    if (this.startAt !== null) {
      if (now < this.startAt) return true;
      this.lastTick = this.startAt;
      this.startAt = null;
    }
    const last = this.lastTick ?? now;
    this.lastTick = now;
    const step = (now - last) / 1000 / Math.max(1e-6, this.runDuration);
    const target = this.segment.f1;
    this.fraction = target >= this.fraction ? Math.min(target, this.fraction + step) : Math.max(target, this.fraction - step);
    this.redraw();
    if (this.fraction !== target) return true;
    const position = this._isReversed ? UIViewAnimatingPosition.start : UIViewAnimatingPosition.end;
    if (this.pausesOnCompletion) {
      this._isRunning = false;
      return false;
    }
    this._isRunning = false;
    this.applyPosition(position);
    this._state = UIViewAnimatingState.inactive;
    this.complete(position);
    return false;
  }

  private redraw(): void {
    for (const group of this.groups) for (const a of group.animations) a.layer.setNeedsDisplay();
  }

  /** Remove the layer animations, leaving the model at `position`. */
  private applyPosition(position: UIViewAnimatingPosition): void {
    if (position === UIViewAnimatingPosition.current) {
      this.settle(position);
      return;
    }
    withoutAnimation(() => {
      for (const group of this.groups) {
        for (const a of group.animations) {
          a.layer.removeAnimation(a.animationKey);
          if (position === UIViewAnimatingPosition.start) assign(a.view, a.layer, a.key, a.from);
        }
      }
    });
    this.groups.length = 0;
  }

  /** Model := what is on screen; animations removed. */
  private settle(_position: UIViewAnimatingPosition): void {
    withoutAnimation(() => {
      for (const group of this.groups) {
        for (const a of group.animations) {
          const value = keyPathSpec(a.key).get(a.layer._presentationState());
          a.layer.removeAnimation(a.animationKey);
          assign(a.view, a.layer, a.key, value);
        }
      }
    });
    this.groups.length = 0;
  }

  private complete(position: UIViewAnimatingPosition): void {
    const completions = this.completions.slice();
    mainQueueAsync(() => {
      for (const completion of completions) completion(position);
    }, this.kernel);
  }
}

/** Set a model value through the view's API (it caches transform and colors), or the layer's. */
function assign(view: UIView | null, layer: CALayer, key: string, value: number[]): void {
  switch (key) {
    case 'position':
      if (view) view.center = { x: value[0]!, y: value[1]! };
      else layer.position = { x: value[0]!, y: value[1]! };
      return;
    case 'bounds': {
      const rect = { origin: { x: value[0]!, y: value[1]! }, size: { width: value[2]!, height: value[3]! } };
      if (view) view.bounds = rect;
      else layer.boundsRect = rect;
      return;
    }
    case 'opacity':
      if (view) view.alpha = value[0]!;
      else layer.opacity = value[0]!;
      return;
    case 'transform':
      if (view) view.transform = fromMatrix(value as Matrix);
      else layer.affineTransform = value as Matrix;
      return;
    case 'backgroundColor':
      if (view) view.backgroundColor = UIColor.fromRGBA(packColor(value));
      else layer.backgroundColor = packColor(value);
      return;
    case 'cornerRadius':
      layer.cornerRadius = value[0]!;
      return;
  }
}
