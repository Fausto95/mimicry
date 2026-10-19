import type { Kernel } from '@mimicry/os-core';
import type { TimeInterpolator } from './interpolators';
import { Animator, ValueAnimator, type AnimatorListener } from './value-animator';

/**
 * android.animation.AnimatorSet: animators played together, in sequence or
 * in a dependency graph built with play(a).with(b).before(c).after(d).
 *
 * A child starts once everything it depends on has started (`with`) or
 * ended (`before` / `after`); the set ends when every child has ended. A
 * duration or interpolator set on the set overrides its children's when it
 * starts, as in the framework. Reverse playback is not modeled.
 */
interface Dependency {
  node: SetNode;
  rule: 'start' | 'end';
}

interface SetNode {
  animator: Animator;
  deps: Dependency[];
  started: boolean;
  ended: boolean;
}

export class AnimatorSet extends Animator {
  private readonly nodes: SetNode[] = [];
  private duration = -1;
  private startDelay = 0;
  private interpolator: TimeInterpolator | null = null;
  private started = false;
  private delayAnimator: ValueAnimator | null = null;
  private delayPassed = false;
  /** while cancelling or ending: children ending must not start their dependents */
  private terminating = false;
  private kernel: Kernel | null = null;

  private readonly childListener: AnimatorListener = {
    onAnimationEnd: (animation) => this.childEnded(animation),
  };

  /** @internal */
  nodeFor(animator: Animator): SetNode {
    let node = this.nodes.find((n) => n.animator === animator);
    if (!node) {
      node = { animator, deps: [], started: false, ended: false };
      this.nodes.push(node);
    }
    return node;
  }

  play(animator: Animator): AnimatorSetBuilder {
    return new AnimatorSetBuilder(this, this.nodeFor(animator));
  }

  playTogether(...items: Array<Animator | Animator[]>): void {
    const animators = items.flat();
    if (!animators.length) return;
    const builder = this.play(animators[0]!);
    for (const a of animators.slice(1)) builder.with(a);
  }

  playSequentially(...items: Array<Animator | Animator[]>): void {
    const animators = items.flat();
    if (animators.length === 1) this.play(animators[0]!);
    for (let i = 0; i < animators.length - 1; i++) this.play(animators[i]!).before(animators[i + 1]!);
  }

  getChildAnimations(): Animator[] {
    return this.nodes.filter((n) => !(n.animator instanceof DelayAnimator)).map((n) => n.animator);
  }

  override setKernel(kernel: Kernel | null): void {
    this.kernel = kernel;
    for (const n of this.nodes) n.animator.setKernel(kernel);
  }

  override setTarget(target: unknown): void {
    for (const n of this.nodes) n.animator.setTarget(target);
  }

  setDuration(duration: number): this {
    if (duration < 0) throw new Error('IllegalArgumentException: duration must be a value of zero or greater');
    this.duration = duration;
    return this;
  }

  getDuration(): number {
    return this.duration;
  }

  setStartDelay(delay: number): void {
    this.startDelay = Math.max(0, delay);
  }

  getStartDelay(): number {
    return this.startDelay;
  }

  setInterpolator(interpolator: TimeInterpolator | null): void {
    this.interpolator = interpolator;
  }

  getInterpolator(): TimeInterpolator | null {
    return this.interpolator;
  }

  override getTotalDuration(): number {
    const ends = new Map<SetNode, number>();
    const startOf = new Map<SetNode, number>();
    let infinite = false;
    const resolve = (node: SetNode, seen: Set<SetNode>): number => {
      const known = ends.get(node);
      if (known !== undefined) return known;
      if (seen.has(node)) return 0;
      seen.add(node);
      let start = 0;
      for (const d of node.deps) {
        resolve(d.node, seen);
        start = Math.max(start, d.rule === 'start' ? startOf.get(d.node) ?? 0 : ends.get(d.node) ?? 0);
      }
      const own = this.duration >= 0 && !(node.animator instanceof DelayAnimator) ? node.animator.getStartDelay() + this.duration : node.animator.getTotalDuration();
      if (own === Animator.DURATION_INFINITE) infinite = true;
      startOf.set(node, start);
      ends.set(node, start + Math.max(0, own));
      return start + own;
    };
    let total = 0;
    for (const n of this.nodes) total = Math.max(total, resolve(n, new Set()));
    return infinite ? Animator.DURATION_INFINITE : this.startDelay + total;
  }

  isRunning(): boolean {
    return this.started && (this.startDelay === 0 || this.delayPassed);
  }

  override isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) this.cancelSilently();
    this.prepare();
    this.started = true;
    this.paused = false;
    this.notifyStart(false);
    if (!this.nodes.length) {
      this.finish();
      return;
    }
    if (this.startDelay > 0) {
      const delay = new DelayAnimator(this.startDelay);
      delay.setKernel(this.kernel);
      delay.addListener({
        onAnimationEnd: () => {
          if (this.delayAnimator !== delay || this.terminating) return;
          this.delayAnimator = null;
          this.delayPassed = true;
          this.startReady();
        },
      });
      this.delayAnimator = delay;
      delay.start();
    } else {
      this.delayPassed = true;
      this.startReady();
    }
  }

  private prepare(): void {
    this.delayPassed = false;
    for (const n of this.nodes) {
      n.started = false;
      n.ended = false;
      if (n.animator instanceof DelayAnimator) continue;
      if (this.duration >= 0) n.animator.setDuration(this.duration);
      if (this.interpolator) n.animator.setInterpolator(this.interpolator);
    }
  }

  private ready(node: SetNode): boolean {
    return !node.started && node.deps.every((d) => (d.rule === 'start' ? d.node.started : d.node.ended));
  }

  private startReady(): void {
    for (;;) {
      const next = this.nodes.find((n) => this.ready(n));
      if (!next) return;
      this.startNode(next);
    }
  }

  private startNode(node: SetNode): void {
    node.started = true;
    node.animator.removeListener(this.childListener);
    node.animator.addListener(this.childListener);
    node.animator.start();
  }

  private childEnded(animator: Animator): void {
    const node = this.nodes.find((n) => n.animator === animator);
    if (!node || !node.started || node.ended) return;
    node.ended = true;
    animator.removeListener(this.childListener);
    if (this.terminating || !this.started) return;
    this.startReady();
    if (this.nodes.every((n) => n.ended)) this.finish();
  }

  private finish(): void {
    if (!this.started) return;
    this.started = false;
    this.delayPassed = false;
    this.notifyEnd(false);
  }

  private cancelSilently(): void {
    this.terminating = true;
    this.delayAnimator?.cancel();
    this.delayAnimator = null;
    for (const n of this.nodes) {
      if (n.started && !n.ended) n.animator.cancel();
      n.animator.removeListener(this.childListener);
    }
    this.terminating = false;
    this.started = false;
  }

  cancel(): void {
    if (!this.started) return;
    this.notifyCancel();
    this.terminating = true;
    this.delayAnimator?.cancel();
    this.delayAnimator = null;
    for (const n of this.nodes) {
      if (n.started && !n.ended) n.animator.cancel();
      n.animator.removeListener(this.childListener);
    }
    this.terminating = false;
    this.finish();
  }

  /** Jump every child to its end value, in dependency order. */
  end(): void {
    if (!this.started) {
      this.prepare();
      this.started = true;
      this.notifyStart(false);
    }
    this.terminating = true;
    this.delayAnimator?.cancel();
    this.delayAnimator = null;
    const done = new Set<SetNode>();
    const satisfied = (n: SetNode) => n.deps.every((d) => done.has(d.node));
    while (done.size < this.nodes.length) {
      const next = this.nodes.find((n) => !done.has(n) && satisfied(n)) ?? this.nodes.find((n) => !done.has(n))!;
      if (!(next.animator instanceof DelayAnimator)) {
        if (!next.started) next.animator.start();
        next.animator.end();
      }
      next.started = true;
      next.ended = true;
      next.animator.removeListener(this.childListener);
      done.add(next);
    }
    this.terminating = false;
    this.finish();
  }

  override pause(): void {
    super.pause();
    if (this.paused) for (const n of this.nodes) if (n.started && !n.ended) n.animator.pause();
    this.delayAnimator?.pause();
  }

  override resume(): void {
    const was = this.paused;
    super.resume();
    if (was) for (const n of this.nodes) if (n.started && !n.ended) n.animator.resume();
    this.delayAnimator?.resume();
  }
}

/** AnimatorSet.Builder: dependencies relative to the animator passed to play(). */
export class AnimatorSetBuilder {
  constructor(private readonly set: AnimatorSet, private readonly current: SetNode) {}

  /** `animator` starts when the current one starts. */
  with(animator: Animator): this {
    this.set.nodeFor(animator).deps.push({ node: this.current, rule: 'start' });
    return this;
  }

  /** `animator` starts when the current one ends. */
  before(animator: Animator): this {
    this.set.nodeFor(animator).deps.push({ node: this.current, rule: 'end' });
    return this;
  }

  /** The current animator starts when `animator` ends (or after `delay` ms). */
  after(animatorOrDelay: Animator | number): this {
    const other = typeof animatorOrDelay === 'number' ? new DelayAnimator(animatorOrDelay) : animatorOrDelay;
    this.current.deps.push({ node: this.set.nodeFor(other), rule: 'end' });
    return this;
  }
}

/** The empty animator AnimatorSet.Builder.after(delay) waits on. */
class DelayAnimator extends ValueAnimator {
  constructor(delay: number) {
    super();
    this.setFloatValues(0, 1);
    this.setDuration(delay);
  }
}
