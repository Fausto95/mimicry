import {
  keyPathSpec, subtractValues, toVector, zeroValue, packColor,
} from '../quartz-core/animatable';
import {
  CAAnimationCalculationMode, CABasicAnimation, CAKeyframeAnimation, CAMediaTimingFillMode, CASpringAnimation,
  type CAAnimation, type CAAnimationDelegate,
} from '../quartz-core/ca-animation';
import { CALayer, layerActions } from '../quartz-core/ca-layer';
import { kernelOf, mediaNow, mainQueueAsync, CAEnvironment } from '../quartz-core/ca-media-time';
import { CAMediaTimingFunction, CAMediaTimingFunctionName } from '../quartz-core/ca-media-timing-function';
import { recordLayerTree, SnapshotLayer } from '../quartz-core/layer-snapshot';
import { dampingRatioSpring, perceptualSpring, springSettlingDuration, type SpringParameters } from '../quartz-core/spring';
import type { UIView } from './ui-view';

/**
 * UIView's block-based animations, built on Core Animation the way UIKit
 * builds them (iOS 8+): inside an animation block, setting an animatable
 * view property (frame, bounds, center, alpha, transform, backgroundColor,
 * and the layer's cornerRadius) changes the model at once and records the
 * old value; when the block returns, every change becomes an *additive*
 * CABasicAnimation (or CASpringAnimation) from old − new to zero, so an
 * animation started while another runs blends from wherever things are on
 * screen. Colors animate from their on-screen value instead.
 *
 * Nested blocks inherit the outer block's duration and curve unless they
 * pass overrideInheritedDuration / overrideInheritedCurve. Animated views
 * ignore touches until their animations end, unless allowUserInteraction.
 */
export enum UIViewAnimationOptions {
  layoutSubviews = 1 << 0,
  allowUserInteraction = 1 << 1,
  beginFromCurrentState = 1 << 2,
  repeat = 1 << 3,
  autoreverse = 1 << 4,
  overrideInheritedDuration = 1 << 5,
  overrideInheritedCurve = 1 << 6,
  allowAnimatedContent = 1 << 7,
  showHideTransitionViews = 1 << 8,
  overrideInheritedOptions = 1 << 9,
  curveEaseInOut = 0 << 16,
  curveEaseIn = 1 << 16,
  curveEaseOut = 2 << 16,
  curveLinear = 3 << 16,
  transitionNone = 0 << 20,
  transitionFlipFromLeft = 1 << 20,
  transitionFlipFromRight = 2 << 20,
  transitionCurlUp = 3 << 20,
  transitionCurlDown = 4 << 20,
  transitionCrossDissolve = 5 << 20,
  transitionFlipFromTop = 6 << 20,
  transitionFlipFromBottom = 7 << 20,
}

export enum UIViewAnimationCurve { easeInOut = 0, easeIn = 1, easeOut = 2, linear = 3 }

export enum UIViewKeyframeAnimationOptions {
  layoutSubviews = 1 << 0,
  allowUserInteraction = 1 << 1,
  beginFromCurrentState = 1 << 2,
  repeat = 1 << 3,
  autoreverse = 1 << 4,
  overrideInheritedDuration = 1 << 5,
  overrideInheritedOptions = 1 << 9,
  calculationModeLinear = 0 << 10,
  calculationModeDiscrete = 1 << 10,
  calculationModePaced = 2 << 10,
  calculationModeCubic = 3 << 10,
  calculationModeCubicPaced = 4 << 10,
}

export type UIViewAnimationCompletion = (finished: boolean) => void;

const CURVES: Record<UIViewAnimationCurve, CAMediaTimingFunctionName> = {
  [UIViewAnimationCurve.easeInOut]: CAMediaTimingFunctionName.easeInEaseOut,
  [UIViewAnimationCurve.easeIn]: CAMediaTimingFunctionName.easeIn,
  [UIViewAnimationCurve.easeOut]: CAMediaTimingFunctionName.easeOut,
  [UIViewAnimationCurve.linear]: CAMediaTimingFunctionName.linear,
};

export function timingFunctionFor(curve: UIViewAnimationCurve): CAMediaTimingFunction {
  return new CAMediaTimingFunction(CURVES[curve] ?? CAMediaTimingFunctionName.easeInEaseOut);
}

const curveOf = (options: number): UIViewAnimationCurve => ((options >> 16) & 3) as UIViewAnimationCurve;

/** How the changes of a block move: a curve over a duration, or a spring. */
export type BlockTiming =
  | { kind: 'curve'; duration: number; curve: CAMediaTimingFunction }
  | { kind: 'spring'; duration: number; spring: SpringParameters };

interface Change {
  view: UIView | null;
  layer: CALayer;
  key: string;
  /** the model value before the block changed it (on-screen value for colors) */
  from: number[];
}

/** One animation block being recorded (UIKit's _UIViewAnimationState). */
export class AnimationBlock {
  readonly changes = new Map<CALayer, Map<string, Change>>();

  constructor(
    readonly timing: BlockTiming,
    readonly delay: number,
    readonly options: number,
  ) {}

  /** A property of `layer` is about to change: remember where it was. */
  willChange(view: UIView | null, layer: CALayer, keys: readonly string[]): void {
    let byKey = this.changes.get(layer);
    if (!byKey) this.changes.set(layer, (byKey = new Map()));
    for (const key of keys) {
      if (byKey.has(key)) continue;
      const spec = keyPathSpec(key);
      // Colors aren't additive: they start from what is on screen now.
      const state = spec.kind === 'color' ? layer._presentationState() : layer._modelState();
      byKey.set(key, { view, layer, key, from: spec.get(state) });
    }
  }

  /** Turn the recorded changes into animations; returns them (none when nothing changed). */
  commit(delegate: CAAnimationDelegate): Array<{ view: UIView | null; layer: CALayer; animation: CAAnimation }> {
    const out: Array<{ view: UIView | null; layer: CALayer; animation: CAAnimation }> = [];
    const kernel = CAEnvironment.kernel;
    const begin = this.delay > 0 ? mediaNow(kernel) / 1000 + this.delay : 0;
    for (const [layer, byKey] of this.changes) {
      for (const change of byKey.values()) {
        const spec = keyPathSpec(change.key);
        const to = spec.get(layer._modelState());
        if (sameVector(change.from, to)) continue;
        const animation = this.timing.kind === 'spring' ? new CASpringAnimation(change.key) : new CABasicAnimation(change.key);
        if (this.timing.kind === 'spring' && animation instanceof CASpringAnimation) {
          Object.assign(animation, this.timing.spring);
          animation.allowsOverdamping = true;
        } else if (this.timing.kind === 'curve') {
          animation.timingFunction = this.timing.curve;
        }
        if (spec.kind === 'color') {
          animation.fromValue = packColor(change.from);
        } else {
          animation.isAdditive = true;
          animation.fromValue = subtractValues(spec.kind, change.from, to);
          animation.toValue = zeroValue(spec.kind, to.length);
        }
        animation.duration = this.timing.duration;
        animation.beginTime = begin;
        animation.fillMode = CAMediaTimingFillMode.backwards;
        if (this.options & UIViewAnimationOptions.repeat) animation.repeatCount = Infinity;
        if (this.options & UIViewAnimationOptions.autoreverse) animation.autoreverses = true;
        animation.delegate = delegate;
        out.push({ view: change.view, layer, animation });
      }
    }
    return out;
  }
}

const sameVector = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

// ── the block stack ──────────────────────────────────────────────────────

/** null entries are performWithoutAnimation scopes. */
const blocks: Array<AnimationBlock | null> = [];

export const UIViewAnimationSettings = { enabled: true };

/** The block property changes are recorded into right now (null outside blocks). */
export function currentAnimationBlock(): AnimationBlock | null {
  if (!UIViewAnimationSettings.enabled) return null;
  return blocks[blocks.length - 1] ?? null;
}

// UIView-backed layers report cornerRadius changes to the open block.
layerActions.willChange = (layer, key) => {
  const block = currentAnimationBlock();
  if (block && layer.layerDelegate) block.willChange(viewOfLayer(layer), layer, [key]);
};

const layerViews = new WeakMap<CALayer, UIView>();

/** @internal UIView registers its layer so recorded layer changes know their view. */
export function registerViewLayer(view: UIView, layer: CALayer): void {
  layerViews.set(layer, view);
}

function viewOfLayer(layer: CALayer): UIView | null {
  return layerViews.get(layer) ?? null;
}

/** @internal run `body` with `block` recording property changes (null: none animate) */
export function recordInto(block: AnimationBlock | null, body: () => void): void {
  blocks.push(block);
  try {
    body();
  } finally {
    blocks.pop();
  }
}

/** Completion bookkeeping shared by every animation a block created. */
class BlockDelegate implements CAAnimationDelegate {
  private running = 0;
  private finishedAll = true;
  private readonly unlock: Array<UIView> = [];

  constructor(private readonly completion: UIViewAnimationCompletion | undefined) {}

  start(count: number, lockedViews: UIView[]): void {
    this.running = count;
    for (const view of lockedViews) {
      view._animationInteractionLocks++;
      this.unlock.push(view);
    }
    if (count === 0) this.done();
  }

  animationDidStop(_animation: CAAnimation, finished: boolean): void {
    if (!finished) this.finishedAll = false;
    if (--this.running === 0) this.done();
  }

  private done(): void {
    for (const view of this.unlock.splice(0)) view._animationInteractionLocks--;
    const completion = this.completion;
    if (!completion) return;
    const finished = this.finishedAll;
    // UIKit calls completion handlers on the main queue, after the work that ended them.
    mainQueueAsync(() => completion(finished));
  }
}

/** Resolve a block's timing against the block it is nested in. */
function inherit(timing: BlockTiming, options: number): BlockTiming {
  const outer = blocks[blocks.length - 1];
  if (!outer || options & UIViewAnimationOptions.overrideInheritedOptions) return timing;
  let result = timing;
  if (!(options & UIViewAnimationOptions.overrideInheritedDuration)) result = { ...result, duration: outer.timing.duration } as BlockTiming;
  if (!(options & UIViewAnimationOptions.overrideInheritedCurve) && result.kind === 'curve' && outer.timing.kind === 'curve') {
    result = { ...result, curve: outer.timing.curve };
  }
  return result;
}

/** UIView.animate(…): the shared implementation of every block-based variant. */
export function runAnimationBlock(
  timing: BlockTiming,
  delay: number,
  options: number,
  animations: () => void,
  completion: UIViewAnimationCompletion | undefined,
): void {
  const resolved = inherit(timing, options);
  const animated = UIViewAnimationSettings.enabled && (resolved.duration > 0 || delay > 0);
  if (!animated) {
    recordInto(null, animations);
    if (completion) mainQueueAsync(() => completion(true));
    return;
  }
  const block = new AnimationBlock(resolved, delay, options);
  recordInto(block, animations);
  if (options & UIViewAnimationOptions.layoutSubviews) {
    for (const change of new Set(Array.from(block.changes.values()).flatMap((m) => Array.from(m.values()).map((c) => c.view)))) change?.layoutIfNeeded();
  }
  const delegate = new BlockDelegate(completion);
  const created = block.commit(delegate);
  const locked = options & UIViewAnimationOptions.allowUserInteraction
    ? []
    : Array.from(new Set(created.map((c) => c.view).filter((v): v is UIView => !!v)));
  delegate.start(created.length, locked);
  for (const { layer, animation } of created) layer.add(animation, uniqueKey(layer, (animation as CABasicAnimation).keyPath ?? 'animation'));
}

function uniqueKey(layer: CALayer, base: string): string {
  if (!layer.animation(base)) return base;
  for (let n = 1; ; n++) if (!layer.animation(`${base}-${n}`)) return `${base}-${n}`;
}

export function curveTiming(duration: number, options: number): BlockTiming {
  return { kind: 'curve', duration, curve: timingFunctionFor(curveOf(options)) };
}

/** animate(withDuration:delay:usingSpringWithDamping:initialSpringVelocity:…) */
export function dampingTiming(duration: number, dampingRatio: number, velocity: number): BlockTiming {
  return { kind: 'spring', duration, spring: dampingRatioSpring(duration, dampingRatio, velocity) };
}

/** iOS 17 animate(springDuration:bounce:initialSpringVelocity:…): runs until the spring settles. */
export function perceptualTiming(duration: number, bounce: number, velocity: number): BlockTiming {
  const spring = perceptualSpring(duration, bounce, velocity);
  return { kind: 'spring', duration: springSettlingDuration(spring), spring };
}

/** performWithoutAnimation(_:) */
export function withoutAnimation(body: () => void): void {
  recordInto(null, body);
}

/** UIView.inheritedAnimationDuration: the duration of the block being recorded (0 outside). */
export function inheritedAnimationDuration(): number {
  return currentAnimationBlock()?.timing.duration ?? 0;
}

// ── keyframes ────────────────────────────────────────────────────────────

interface KeyframeStep {
  start: number;
  duration: number;
  /** values after this keyframe, by layer and key */
  values: Map<CALayer, Map<string, number[]>>;
}

let keyframes: { steps: KeyframeStep[]; block: AnimationBlock } | null = null;

/** animateKeyframes(withDuration:delay:options:animations:completion:) */
export function runKeyframeBlock(
  duration: number,
  delay: number,
  options: number,
  animations: () => void,
  completion: UIViewAnimationCompletion | undefined,
): void {
  if (!UIViewAnimationSettings.enabled || duration <= 0) {
    runAnimationBlock(curveTiming(0, 0), 0, 0, animations, completion);
    return;
  }
  const outer = keyframes;
  // Records the starting values of everything the keyframes touch.
  const block = new AnimationBlock({ kind: 'curve', duration, curve: CAMediaTimingFunction.linear }, delay, options);
  const context = { steps: [] as KeyframeStep[], block };
  keyframes = context;
  try {
    recordInto(null, animations);
  } finally {
    keyframes = outer;
  }
  const mode = [
    CAAnimationCalculationMode.linear, CAAnimationCalculationMode.discrete, CAAnimationCalculationMode.paced,
    CAAnimationCalculationMode.cubic, CAAnimationCalculationMode.cubicPaced,
  ][(options >> 10) & 7] ?? CAAnimationCalculationMode.linear;
  const delegate = new BlockDelegate(completion);
  const created: Array<{ view: UIView | null; layer: CALayer; animation: CAAnimation }> = [];
  const begin = delay > 0 ? mediaNow(CAEnvironment.kernel) / 1000 + delay : 0;
  for (const [layer, byKey] of block.changes) {
    for (const change of byKey.values()) {
      const kind = keyPathSpec(change.key).kind;
      const values: number[][] = [change.from];
      const times: number[] = [0];
      let last = change.from;
      for (const step of context.steps.slice().sort((a, b) => a.start - b.start)) {
        const value = step.values.get(layer)?.get(change.key);
        if (!value) continue;
        if (step.start > times[times.length - 1]!) {
          values.push(last);
          times.push(step.start);
        }
        values.push(value);
        times.push(Math.min(1, step.start + step.duration));
        last = value;
      }
      if (times[times.length - 1]! < 1) {
        values.push(last);
        times.push(1);
      }
      const animation = new CAKeyframeAnimation(change.key);
      animation.values = values.map((v) => (kind === 'color' ? packColor(v) : v));
      animation.keyTimes = times;
      animation.calculationMode = mode;
      animation.duration = duration;
      animation.beginTime = begin;
      animation.fillMode = CAMediaTimingFillMode.backwards;
      if (options & UIViewKeyframeAnimationOptions.repeat) animation.repeatCount = Infinity;
      if (options & UIViewKeyframeAnimationOptions.autoreverse) animation.autoreverses = true;
      animation.delegate = delegate;
      created.push({ view: change.view, layer, animation });
    }
  }
  const locked = options & UIViewAnimationOptions.allowUserInteraction
    ? []
    : Array.from(new Set(created.map((c) => c.view).filter((v): v is UIView => !!v)));
  delegate.start(created.length, locked);
  for (const { layer, animation } of created) layer.add(animation, uniqueKey(layer, (animation as CAKeyframeAnimation).keyPath ?? 'keyframes'));
}

/** addKeyframe(withRelativeStartTime:relativeDuration:animations:) */
export function addKeyframe(relativeStartTime: number, relativeDuration: number, animations: () => void): void {
  const context = keyframes;
  if (!context) {
    animations();
    return;
  }
  const probe = new AnimationBlock(context.block.timing, 0, 0);
  recordInto(probe, animations);
  const step: KeyframeStep = { start: Math.max(0, relativeStartTime), duration: Math.max(0, relativeDuration), values: new Map() };
  for (const [layer, byKey] of probe.changes) {
    let overall = context.block.changes.get(layer);
    if (!overall) context.block.changes.set(layer, (overall = new Map()));
    const values = new Map<string, number[]>();
    for (const [key, change] of byKey) {
      // The first keyframe that touches a key holds the value it starts from.
      if (!overall.has(key)) overall.set(key, change);
      values.set(key, keyPathSpec(key).get(layer._modelState()));
    }
    step.values.set(layer, values);
  }
  context.steps.push(step);
}

// ── transitions ──────────────────────────────────────────────────────────

/**
 * transition(with:duration:options:animations:completion:): the view's old
 * rendering, captured before the block runs, cross-dissolves into the new
 * one. Flips and curls are drawn as cross-dissolves (see docs/os-ios.md).
 */
export function runTransition(
  view: UIView,
  duration: number,
  options: number,
  animations: (() => void) | null,
  completion: UIViewAnimationCompletion | undefined,
): void {
  const style = (options >> 20) & 7;
  if (style === 0 || !UIViewAnimationSettings.enabled || duration <= 0) {
    runAnimationBlock(curveTiming(duration, options), 0, options, animations ?? (() => {}), completion);
    return;
  }
  const kernel = kernelOf(view.layer.root.host);
  const snapshot = new SnapshotLayer(recordLayerTree(view.layer, kernel?.viewport.scale ?? 3));
  // Above the subviews, at the view's visible top-left (sublayers draw offset by the bounds origin).
  snapshot.setFrame(view.layer.originX, view.layer.originY, view.layer.width, view.layer.height);
  view.layer.addSublayer(snapshot);
  if (options & UIViewAnimationOptions.allowAnimatedContent) {
    runAnimationBlock(curveTiming(duration, options), 0, options | UIViewAnimationOptions.overrideInheritedOptions, animations ?? (() => {}), undefined);
  } else if (animations) {
    withoutAnimation(animations);
  }
  const fade = new CABasicAnimation('opacity');
  fade.fromValue = 1;
  fade.toValue = 0;
  fade.duration = duration;
  fade.timingFunction = timingFunctionFor(curveOf(options));
  fade.fillMode = CAMediaTimingFillMode.forwards;
  fade.isRemovedOnCompletion = false;
  const delegate = new BlockDelegate((finished) => {
    snapshot.removeFromSuperlayer();
    completion?.(finished);
  });
  fade.delegate = delegate;
  delegate.start(1, options & UIViewAnimationOptions.allowUserInteraction ? [] : [view]);
  snapshot.add(fade, 'transition');
}

/** transition(from:to:duration:options:completion:) */
export function runViewSwap(
  from: UIView,
  to: UIView,
  duration: number,
  options: number,
  completion: UIViewAnimationCompletion | undefined,
): void {
  const showHide = (options & UIViewAnimationOptions.showHideTransitionViews) !== 0;
  const parent = from.superview;
  if (showHide) to.isHidden = false;
  else if (parent && to.superview !== parent) parent.insertSubviewAbove(to, from);
  const finish = (finished: boolean) => {
    if (showHide) from.isHidden = true;
    else from.removeFromSuperview();
    completion?.(finished);
  };
  const style = (options >> 20) & 7;
  if (style === 0 || !UIViewAnimationSettings.enabled || duration <= 0) {
    finish(true);
    return;
  }
  const timing = timingFunctionFor(curveOf(options));
  const delegate = new BlockDelegate((finished) => {
    from.layer.removeAnimation('transition');
    finish(finished);
  });
  const fadeOut = new CABasicAnimation('opacity');
  fadeOut.fromValue = from.alpha;
  fadeOut.toValue = 0;
  fadeOut.fillMode = CAMediaTimingFillMode.forwards;
  fadeOut.isRemovedOnCompletion = false;
  const fadeIn = new CABasicAnimation('opacity');
  fadeIn.fromValue = 0;
  fadeIn.toValue = to.alpha;
  for (const a of [fadeOut, fadeIn]) {
    a.duration = duration;
    a.timingFunction = timing;
    a.delegate = delegate;
  }
  delegate.start(2, options & UIViewAnimationOptions.allowUserInteraction ? [] : [from, to]);
  from.layer.add(fadeOut, 'transition');
  to.layer.add(fadeIn, 'transition');
}

/** Values a UIView setter reports: the key paths a property maps to. */
export const VIEW_KEYS = {
  frame: ['position', 'bounds'],
  bounds: ['bounds', 'position'],
  center: ['position'],
  alpha: ['opacity'],
  transform: ['transform'],
  backgroundColor: ['backgroundColor'],
} as const;

/** @internal a vector for a color (UIView's backgroundColor animations). */
export function colorVector(rgba: number): number[] {
  return toVector(rgba, 'color');
}
