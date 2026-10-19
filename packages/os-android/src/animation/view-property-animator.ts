import type { View } from '../view/view';
import type { TimeInterpolator } from './interpolators';
import { ValueAnimator, type Animator, type AnimatorListener, type AnimatorUpdateListener } from './value-animator';

/**
 * android.view.ViewPropertyAnimator (`view.animate()`): batches property
 * changes made in one go into a single ValueAnimator that starts on the next
 * animation frame (or at once with start()). Starting a property that is
 * already animating takes it over from the running animation. End actions
 * run only when the animation ends normally, not when it is cancelled.
 *
 * rotationX / rotationY are accepted but only stored: the render tree is 2D.
 */
type Prop = 'translationX' | 'translationY' | 'translationZ' | 'scaleX' | 'scaleY' | 'rotation' | 'rotationX' | 'rotationY' | 'x' | 'y' | 'z' | 'alpha';

interface NameValues {
  name: Prop;
  from: number;
  delta: number;
}

/** from + delta × fraction, landing exactly on the target at the end. */
const valueAt = (v: NameValues, fraction: number) => (fraction === 1 ? v.from + v.delta : v.from + v.delta * fraction);

interface PropertyBundle {
  values: NameValues[];
}

const ACCESSORS: Record<Prop, { get(v: View): number; set(v: View, value: number): void }> = {
  translationX: { get: (v) => v.getTranslationX(), set: (v, x) => v.setTranslationX(x) },
  translationY: { get: (v) => v.getTranslationY(), set: (v, x) => v.setTranslationY(x) },
  translationZ: { get: (v) => v.getTranslationZ(), set: (v, x) => v.setTranslationZ(x) },
  scaleX: { get: (v) => v.getScaleX(), set: (v, x) => v.setScaleX(x) },
  scaleY: { get: (v) => v.getScaleY(), set: (v, x) => v.setScaleY(x) },
  rotation: { get: (v) => v.getRotation(), set: (v, x) => v.setRotation(x) },
  rotationX: { get: (v) => v.getRotationX(), set: (v, x) => v.setRotationX(x) },
  rotationY: { get: (v) => v.getRotationY(), set: (v, x) => v.setRotationY(x) },
  x: { get: (v) => v.getX(), set: (v, x) => v.setX(x) },
  y: { get: (v) => v.getY(), set: (v, x) => v.setY(x) },
  z: { get: (v) => v.getZ(), set: (v, x) => v.setZ(x) },
  alpha: { get: (v) => v.getAlpha(), set: (v, x) => v.setAlpha(x) },
};

export class ViewPropertyAnimator {
  private duration: number | null = null;
  private startDelay = 0;
  private interpolator: TimeInterpolator | null = null;
  private listener: AnimatorListener | null = null;
  private updateListener: AnimatorUpdateListener | null = null;
  private pending: Array<{ name: Prop; to: number; by: boolean }> = [];
  private pendingStart: (() => void) | null = null;
  private pendingEnd: (() => void) | null = null;
  private pendingWithLayer = false;
  private readonly running = new Map<ValueAnimator, PropertyBundle>();
  private readonly endActions = new Map<ValueAnimator, () => void>();
  private startScheduled = false;
  private scheduleToken = 0;

  constructor(private readonly view: View) {}

  // ── configuration ───────────────────────────────────────────────────

  setDuration(duration: number): this {
    if (duration < 0) throw new Error(`IllegalArgumentException: Animators cannot have negative duration: ${duration}`);
    this.duration = duration;
    return this;
  }

  /** ValueAnimator's default (300 ms) unless set. */
  getDuration(): number {
    return this.duration ?? 300;
  }

  setStartDelay(delay: number): this {
    if (delay < 0) throw new Error(`IllegalArgumentException: Animators cannot have negative start delay: ${delay}`);
    this.startDelay = delay;
    return this;
  }

  getStartDelay(): number {
    return this.startDelay;
  }

  setInterpolator(interpolator: TimeInterpolator | null): this {
    this.interpolator = interpolator;
    return this;
  }

  getInterpolator(): TimeInterpolator | null {
    return this.interpolator;
  }

  setListener(listener: AnimatorListener | null): this {
    this.listener = listener;
    return this;
  }

  setUpdateListener(listener: AnimatorUpdateListener | null): this {
    this.updateListener = listener;
    return this;
  }

  withStartAction(action: () => void): this {
    this.pendingStart = action;
    this.schedule();
    return this;
  }

  withEndAction(action: () => void): this {
    this.pendingEnd = action;
    this.schedule();
    return this;
  }

  /** A hardware layer for the animation's length (the view composites on its own meanwhile). */
  withLayer(): this {
    this.pendingWithLayer = true;
    this.schedule();
    return this;
  }

  // ── properties ──────────────────────────────────────────────────────

  private animateProperty(name: Prop, value: number, by = false): this {
    this.pending.push({ name, to: value, by });
    this.schedule();
    return this;
  }

  alpha(value: number): this { return this.animateProperty('alpha', value); }
  alphaBy(value: number): this { return this.animateProperty('alpha', value, true); }
  translationX(value: number): this { return this.animateProperty('translationX', value); }
  translationXBy(value: number): this { return this.animateProperty('translationX', value, true); }
  translationY(value: number): this { return this.animateProperty('translationY', value); }
  translationYBy(value: number): this { return this.animateProperty('translationY', value, true); }
  translationZ(value: number): this { return this.animateProperty('translationZ', value); }
  translationZBy(value: number): this { return this.animateProperty('translationZ', value, true); }
  x(value: number): this { return this.animateProperty('x', value); }
  xBy(value: number): this { return this.animateProperty('x', value, true); }
  y(value: number): this { return this.animateProperty('y', value); }
  yBy(value: number): this { return this.animateProperty('y', value, true); }
  z(value: number): this { return this.animateProperty('z', value); }
  zBy(value: number): this { return this.animateProperty('z', value, true); }
  scaleX(value: number): this { return this.animateProperty('scaleX', value); }
  scaleXBy(value: number): this { return this.animateProperty('scaleX', value, true); }
  scaleY(value: number): this { return this.animateProperty('scaleY', value); }
  scaleYBy(value: number): this { return this.animateProperty('scaleY', value, true); }
  rotation(value: number): this { return this.animateProperty('rotation', value); }
  rotationBy(value: number): this { return this.animateProperty('rotation', value, true); }
  rotationX(value: number): this { return this.animateProperty('rotationX', value); }
  rotationXBy(value: number): this { return this.animateProperty('rotationX', value, true); }
  rotationY(value: number): this { return this.animateProperty('rotationY', value); }
  rotationYBy(value: number): this { return this.animateProperty('rotationY', value, true); }

  // ── running ─────────────────────────────────────────────────────────

  /** Start what is pending now instead of on the next frame. */
  start(): void {
    this.startScheduled = false;
    this.scheduleToken++;
    this.startAnimation();
  }

  /** Cancel running and pending animations. */
  cancel(): void {
    for (const animator of Array.from(this.running.keys())) animator.cancel();
    this.running.clear();
    this.pending = [];
    this.pendingStart = null;
    this.pendingEnd = null;
    this.pendingWithLayer = false;
    this.startScheduled = false;
    this.scheduleToken++;
  }

  /** @internal how many animations run (tests) */
  get runningCount(): number {
    return this.running.size;
  }

  private schedule(): void {
    if (this.startScheduled) return;
    const kernel = this.view.context.kernel;
    this.startScheduled = true;
    const token = ++this.scheduleToken;
    // View.postOnAnimation: the batch starts with the next frame's callbacks.
    kernel.animator.requestAnimationFrame(() => {
      if (token !== this.scheduleToken) return;
      this.startScheduled = false;
      this.startAnimation();
    });
    kernel.requestFrame();
  }

  private startAnimation(): void {
    const pending = this.pending;
    const startAction = this.pendingStart;
    const endAction = this.pendingEnd;
    const withLayer = this.pendingWithLayer;
    this.pending = [];
    this.pendingStart = null;
    this.pendingEnd = null;
    this.pendingWithLayer = false;
    if (!pending.length && !startAction && !endAction) return;

    const view = this.view;
    const values: NameValues[] = [];
    for (const p of pending) {
      this.takeOver(p.name);
      const from = ACCESSORS[p.name].get(view);
      const delta = p.by ? p.to : p.to - from;
      const existing = values.find((v) => v.name === p.name);
      if (existing) {
        existing.delta = p.by ? existing.delta + p.to : p.to - existing.from;
      } else values.push({ name: p.name, from, delta });
    }

    const animator = ValueAnimator.ofFloat(1);
    animator.setKernel(view.context.kernel);
    animator.setDuration(this.getDuration());
    animator.setStartDelay(this.startDelay);
    if (this.interpolator) animator.setInterpolator(this.interpolator);
    const bundle: PropertyBundle = { values };
    this.running.set(animator, bundle);
    if (endAction) this.endActions.set(animator, endAction);
    const userListener = this.listener;
    const userUpdate = this.updateListener;
    let previousLayerType = 0;

    animator.addUpdateListener((anim) => {
      const fraction = anim.getAnimatedFraction();
      for (const v of bundle.values) ACCESSORS[v.name].set(view, valueAt(v, fraction));
      if (userUpdate) {
        if (typeof userUpdate === 'function') userUpdate(anim);
        else userUpdate.onAnimationUpdate(anim);
      }
    });
    animator.addListener({
      onAnimationStart: (anim: Animator, reverse: boolean) => {
        if (withLayer) {
          previousLayerType = view.getLayerType();
          view.setLayerType(2, null);
        }
        startAction?.();
        userListener?.onAnimationStart?.(anim, reverse);
      },
      onAnimationCancel: (anim: Animator) => {
        this.endActions.delete(animator);
        userListener?.onAnimationCancel?.(anim);
      },
      onAnimationEnd: (anim: Animator, reverse: boolean) => {
        if (withLayer) view.setLayerType(previousLayerType, null);
        this.running.delete(animator);
        userListener?.onAnimationEnd?.(anim, reverse);
        const end = this.endActions.get(animator);
        this.endActions.delete(animator);
        end?.();
      },
    });
    animator.start();
  }

  /** A new animation of `name` removes it from whichever running one had it. */
  private takeOver(name: Prop): void {
    for (const [animator, bundle] of this.running) {
      const at = bundle.values.findIndex((v) => v.name === name);
      if (at < 0) continue;
      bundle.values.splice(at, 1);
      if (!bundle.values.length) {
        this.running.delete(animator);
        animator.cancel();
      }
    }
  }
}
