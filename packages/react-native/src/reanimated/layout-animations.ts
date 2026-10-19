import type { Frame, HostNode } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';
import { isAnimation, springAnimation, type AnimationObject, type ReduceMotionValue, type WithSpringConfig } from './animations';
import { DEFAULT_TIMING_EASING, Easing, resolveEasing, type EasingFunction, type EasingLike } from './easing';
import { PRESETS } from './presets';
import { uiRuntime, type Driver } from './runtime';
import { addKeyframe, emptyTimeline, playTimeline, type Timeline, type TimelineRun } from './timeline';
import { AnimatedUpdater } from './updater';

/**
 * Layout animations: `entering`, `exiting` and `layout` on Animated
 * components. Presets and `Keyframe` compile to keyframe timelines played on
 * the host node (timeline.ts); custom `(values) => { initialValues,
 * animations }` functions run through the same animation objects as
 * useAnimatedStyle; layout transitions animate the node's frame between two
 * Yoga layouts. Exiting nodes are kept on screen by the engine (tree/exit.ts).
 */
export type LayoutKind = 'entering' | 'exiting';
type Callback = (finished: boolean) => void;
type Style = Record<string, unknown>;

let layoutAnimationsEnabled = true;
export function enableLayoutAnimations(flag: boolean): void {
  layoutAnimationsEnabled = flag;
}

// ── builders ───────────────────────────────────────────────────────────────

export class BaseAnimationBuilder {
  protected durationV?: number;
  protected delayV = 0;
  protected randomizeDelay = false;
  protected reduceMotionV?: ReduceMotionValue;
  protected callbackV?: Callback;
  protected easingV?: EasingFunction;
  protected springConfig?: WithSpringConfig;
  protected initialValues?: Style;

  static createInstance<T extends BaseAnimationBuilder>(this: new () => T): T {
    return new this();
  }

  duration(ms: number): this {
    this.durationV = ms;
    return this;
  }
  delay(ms: number): this {
    this.delayV = ms;
    return this;
  }
  randomDelay(): this {
    this.randomizeDelay = true;
    return this;
  }
  withCallback(callback: Callback): this {
    this.callbackV = callback;
    return this;
  }
  reduceMotion(value: ReduceMotionValue): this {
    this.reduceMotionV = value;
    return this;
  }
  getDuration(): number {
    return this.durationV ?? 300;
  }
  getDelay(): number {
    return this.randomizeDelay ? Math.random() * this.delayV : this.delayV;
  }
  /** Reanimated's builders compile to a worklet; here the builder itself is the compiled form. */
  build(): this {
    return this;
  }

  /** The keyframes of this animation; presets override. */
  protected keyframes(_kind: LayoutKind): { keyframes: Record<number, Style>; duration: number } {
    return { keyframes: {}, duration: 300 };
  }

  /** Compile to a timeline (presets and Keyframe). */
  toTimeline(kind: LayoutKind): Timeline {
    const data = this.keyframes(kind);
    const timeline = emptyTimeline({
      duration: this.durationV ?? data.duration,
      delay: this.getDelay(),
      easing: this.easingV ?? DEFAULT_TIMING_EASING,
      spring: this.springConfig,
    });
    for (const [offset, style] of Object.entries(data.keyframes)) addKeyframe(timeline, Number(offset) / 100, style);
    if (this.initialValues) addKeyframe(timeline, 0, this.initialValues);
    return timeline;
  }

  /** @internal */
  get callback(): Callback | undefined {
    return this.callbackV;
  }
}

export class ComplexAnimationBuilder extends BaseAnimationBuilder {
  easing(easing: EasingLike): this {
    this.easingV = resolveEasing(easing, DEFAULT_TIMING_EASING);
    return this;
  }
  springify(duration?: number): this {
    this.springConfig = { ...(this.springConfig ?? {}), ...(duration != null ? { duration } : {}) };
    return this;
  }
  private spring(patch: WithSpringConfig): this {
    this.springConfig = { ...(this.springConfig ?? {}), ...patch };
    return this;
  }
  damping(value: number): this {
    return this.spring({ damping: value });
  }
  mass(value: number): this {
    return this.spring({ mass: value });
  }
  stiffness(value: number): this {
    return this.spring({ stiffness: value });
  }
  overshootClamping(value: number | boolean): this {
    return this.spring({ overshootClamping: !!value });
  }
  dampingRatio(value: number): this {
    return this.spring({ dampingRatio: value });
  }
  energyThreshold(value: number): this {
    return this.spring({ energyThreshold: value });
  }
  restDisplacementThreshold(value: number): this {
    return this.spring({ restDisplacementThreshold: value });
  }
  restSpeedThreshold(value: number): this {
    return this.spring({ restSpeedThreshold: value });
  }
  withInitialValues(values: Style): this {
    this.initialValues = values;
    return this;
  }
  /** used by a few presets in Reanimated (rotate direction) */
  rotate(_degree: string): this {
    return this;
  }
}

// `FadeIn.duration(200)`: every chainable modifier is also a static factory.
const MODIFIERS = [
  'duration', 'delay', 'randomDelay', 'withCallback', 'reduceMotion', 'build', 'easing', 'springify', 'damping', 'mass',
  'stiffness', 'overshootClamping', 'dampingRatio', 'energyThreshold', 'restDisplacementThreshold', 'restSpeedThreshold',
  'withInitialValues', 'rotate', 'reverse', 'easingX', 'easingY', 'easingWidth', 'easingHeight',
];
for (const name of MODIFIERS) {
  (BaseAnimationBuilder as any)[name] = function (this: new () => any, ...args: unknown[]) {
    return new this()[name](...args);
  };
}

type Chainable<T> = { [K in keyof T]: T[K] extends (...args: any[]) => T ? K : never }[keyof T];
/** A builder class with its chainable instance methods also available as statics. */
export type BuilderClass<C extends abstract new () => any> = C & {
  [K in Chainable<InstanceType<C>>]: (...args: Parameters<InstanceType<C>[K]>) => InstanceType<C>;
};

/** Builders generated from the preset keyframe tables. */
function preset(name: string): BuilderClass<typeof ComplexAnimationBuilder> {
  const data = PRESETS[name]!;
  const Preset = class extends ComplexAnimationBuilder {
    static presetName = name;
    protected override keyframes() {
      return data;
    }
  };
  Object.defineProperty(Preset, 'name', { value: name });
  return Preset as unknown as BuilderClass<typeof ComplexAnimationBuilder>;
}

export const FadeIn = preset('FadeIn');
export const FadeInRight = preset('FadeInRight');
export const FadeInLeft = preset('FadeInLeft');
export const FadeInUp = preset('FadeInUp');
export const FadeInDown = preset('FadeInDown');
export const FadeOut = preset('FadeOut');
export const FadeOutRight = preset('FadeOutRight');
export const FadeOutLeft = preset('FadeOutLeft');
export const FadeOutUp = preset('FadeOutUp');
export const FadeOutDown = preset('FadeOutDown');
export const SlideInRight = preset('SlideInRight');
export const SlideInLeft = preset('SlideInLeft');
export const SlideInUp = preset('SlideInUp');
export const SlideInDown = preset('SlideInDown');
export const SlideOutRight = preset('SlideOutRight');
export const SlideOutLeft = preset('SlideOutLeft');
export const SlideOutUp = preset('SlideOutUp');
export const SlideOutDown = preset('SlideOutDown');
export const ZoomIn = preset('ZoomIn');
export const ZoomInRotate = preset('ZoomInRotate');
export const ZoomInRight = preset('ZoomInRight');
export const ZoomInLeft = preset('ZoomInLeft');
export const ZoomInUp = preset('ZoomInUp');
export const ZoomInDown = preset('ZoomInDown');
export const ZoomInEasyUp = preset('ZoomInEasyUp');
export const ZoomInEasyDown = preset('ZoomInEasyDown');
export const ZoomOut = preset('ZoomOut');
export const ZoomOutRotate = preset('ZoomOutRotate');
export const ZoomOutRight = preset('ZoomOutRight');
export const ZoomOutLeft = preset('ZoomOutLeft');
export const ZoomOutUp = preset('ZoomOutUp');
export const ZoomOutDown = preset('ZoomOutDown');
export const ZoomOutEasyUp = preset('ZoomOutEasyUp');
export const ZoomOutEasyDown = preset('ZoomOutEasyDown');
export const BounceIn = preset('BounceIn');
export const BounceInRight = preset('BounceInRight');
export const BounceInLeft = preset('BounceInLeft');
export const BounceInUp = preset('BounceInUp');
export const BounceInDown = preset('BounceInDown');
export const BounceOut = preset('BounceOut');
export const BounceOutRight = preset('BounceOutRight');
export const BounceOutLeft = preset('BounceOutLeft');
export const BounceOutUp = preset('BounceOutUp');
export const BounceOutDown = preset('BounceOutDown');
export const FlipInXUp = preset('FlipInXUp');
export const FlipInXDown = preset('FlipInXDown');
export const FlipInYLeft = preset('FlipInYLeft');
export const FlipInYRight = preset('FlipInYRight');
export const FlipInEasyX = preset('FlipInEasyX');
export const FlipInEasyY = preset('FlipInEasyY');
export const FlipOutXUp = preset('FlipOutXUp');
export const FlipOutXDown = preset('FlipOutXDown');
export const FlipOutYLeft = preset('FlipOutYLeft');
export const FlipOutYRight = preset('FlipOutYRight');
export const FlipOutEasyX = preset('FlipOutEasyX');
export const FlipOutEasyY = preset('FlipOutEasyY');
export const StretchInX = preset('StretchInX');
export const StretchInY = preset('StretchInY');
export const StretchOutX = preset('StretchOutX');
export const StretchOutY = preset('StretchOutY');
export const RotateInDownLeft = preset('RotateInDownLeft');
export const RotateInDownRight = preset('RotateInDownRight');
export const RotateInUpLeft = preset('RotateInUpLeft');
export const RotateInUpRight = preset('RotateInUpRight');
export const RotateOutDownLeft = preset('RotateOutDownLeft');
export const RotateOutDownRight = preset('RotateOutDownRight');
export const RotateOutUpLeft = preset('RotateOutUpLeft');
export const RotateOutUpRight = preset('RotateOutUpRight');
export const LightSpeedInRight = preset('LightSpeedInRight');
export const LightSpeedInLeft = preset('LightSpeedInLeft');
export const LightSpeedOutRight = preset('LightSpeedOutRight');
export const LightSpeedOutLeft = preset('LightSpeedOutLeft');
export const PinwheelIn = preset('PinwheelIn');
export const PinwheelOut = preset('PinwheelOut');
export const RollInLeft = preset('RollInLeft');
export const RollInRight = preset('RollInRight');
export const RollOutLeft = preset('RollOutLeft');
export const RollOutRight = preset('RollOutRight');

// ── Keyframe ───────────────────────────────────────────────────────────────

type KeyframeDefinition = Style & { easing?: EasingLike };

/** `new Keyframe({ 0: {…}, 45: { opacity: 1, easing: Easing.exp }, 100: {…} })` */
export class Keyframe {
  private durationV = 500;
  private delayV = 0;
  private callbackV?: Callback;

  constructor(private readonly definitions: Record<string, KeyframeDefinition>) {}

  duration(ms: number): this {
    this.durationV = ms;
    return this;
  }
  delay(ms: number): this {
    this.delayV = ms;
    return this;
  }
  withCallback(callback: Callback): this {
    this.callbackV = callback;
    return this;
  }
  reduceMotion(_value: ReduceMotionValue): this {
    return this;
  }
  build(): this {
    return this;
  }

  /** @internal */
  get callback(): Callback | undefined {
    return this.callbackV;
  }

  toTimeline(): Timeline {
    // Keyframe segments are linear unless a keyframe names its own easing.
    const timeline = emptyTimeline({ duration: this.durationV, delay: this.delayV, easing: Easing.linear });
    for (const [key, definition] of Object.entries(this.definitions)) {
      const offset = key === 'from' ? 0 : key === 'to' ? 1 : Number(key) / 100;
      const { easing, ...style } = definition;
      addKeyframe(timeline, offset, style, easing ? resolveEasing(easing, Easing.linear) : undefined);
    }
    return timeline;
  }
}

// ── running entering / exiting ─────────────────────────────────────────────

type CustomLayoutAnimation = (values: Record<string, number>) => { initialValues?: Style; animations: Style; callback?: Callback };

type LayoutAnimationInput = BaseAnimationBuilder | Keyframe | (new () => BaseAnimationBuilder) | CustomLayoutAnimation;

function instantiate(input: unknown): BaseAnimationBuilder | Keyframe | CustomLayoutAnimation | null {
  if (!input) return null;
  if (input instanceof BaseAnimationBuilder || input instanceof Keyframe) return input;
  if (typeof input === 'function') {
    if (input.prototype instanceof BaseAnimationBuilder) return new (input as new () => BaseAnimationBuilder)();
    return input as CustomLayoutAnimation;
  }
  return null;
}

function layoutValues(node: HostNode, kind: LayoutKind): Record<string, number> {
  const v = maybeEngine()?.viewport;
  const rect = node.engine.geometry.windowRect(node);
  const prefix = kind === 'entering' ? 'target' : 'current';
  return {
    [`${prefix}OriginX`]: node.x,
    [`${prefix}OriginY`]: node.y,
    [`${prefix}Width`]: node.w,
    [`${prefix}Height`]: node.h,
    [`${prefix}GlobalOriginX`]: rect.x,
    [`${prefix}GlobalOriginY`]: rect.y,
    [`${prefix}BorderRadius`]: Number(node.computed.borderRadius ?? 0),
    windowWidth: v?.width ?? 0,
    windowHeight: v?.height ?? 0,
  };
}

/**
 * Play an entering/exiting animation on `node`. Returns a handle to cancel
 * it; `onEnd(finished)` follows the animation's own callback.
 */
export function playLayoutAnimation(node: HostNode, input: LayoutAnimationInput, kind: LayoutKind, onEnd?: (finished: boolean) => void): TimelineRun | null {
  const animation = instantiate(input);
  if (!animation || !layoutAnimationsEnabled) {
    onEnd?.(true);
    return null;
  }
  if (animation instanceof BaseAnimationBuilder || animation instanceof Keyframe) {
    const timeline = animation instanceof Keyframe ? animation.toTimeline() : animation.toTimeline(kind);
    // Exiting views stay at their final keyframe until the engine removes them.
    if (kind === 'exiting') timeline.fill = 'forwards';
    return playTimeline(node, timeline, {
      applyStartNow: true,
      onEnd: (finished) => {
        animation.callback?.(finished);
        onEnd?.(finished);
      },
    });
  }
  return playCustom(node, animation, kind, onEnd);
}

/** `(values) => ({ initialValues, animations, callback })` — Reanimated's custom layout animation. */
function playCustom(node: HostNode, fn: CustomLayoutAnimation, kind: LayoutKind, onEnd?: (finished: boolean) => void): TimelineRun {
  const values = layoutValues(node, kind);
  const { initialValues = {}, animations, callback } = fn(values);
  const origin = { x: values.targetOriginX ?? values.currentOriginX ?? 0, y: values.targetOriginY ?? values.currentOriginY ?? 0 };
  // originX/originY are frame positions; express them as translations from the laid-out frame.
  const toStyle = (style: Style): Style => {
    const out: Style = { ...style };
    const translate: Style[] = [];
    if ('originX' in out) {
      translate.push({ translateX: offset(out.originX, origin.x) });
      delete out.originX;
    }
    if ('originY' in out) {
      translate.push({ translateY: offset(out.originY, origin.y) });
      delete out.originY;
    }
    if (translate.length) out.transform = [...translate, ...((out.transform as Style[]) ?? [])];
    return out;
  };
  const initial = toStyle(initialValues);
  const animated = toStyle(animations);
  const updater = new AnimatedUpdater('style', () => animated, { deferred: true });
  updater.seed(initial);
  node.setOverrides(initial);
  const keys = new Set([...Object.keys(initial), ...Object.keys(animated)]);
  let done = false;
  const runtime = uiRuntime();
  const unsubscribe = updater.subscribe({ update: () => node.setOverrides(updater.snapshot) });
  updater.mapper.run();
  const finish = (finished: boolean) => {
    if (done) return;
    done = true;
    runtime.removeDriver(watcher);
    unsubscribe();
    updater.deactivate();
    if (kind === 'entering') {
      const clear: Style = {};
      for (const k of keys) clear[k] = undefined;
      node.setOverrides(clear);
    }
    callback?.(finished);
    onEnd?.(finished);
  };
  // Finished when none of its animations is running any more.
  const watcher: Driver = {
    step: () => {
      if (!updater.animating) finish(true);
      return !done;
    },
  };
  runtime.addDriver(watcher);
  return {
    cancel: () => finish(false),
    get finished() {
      return done;
    },
  };
}

function offset(value: unknown, origin: number): unknown {
  if (isAnimation(value)) {
    const a = value as AnimationObject;
    if (typeof a.toValue === 'number') a.toValue = a.toValue - origin;
    return a;
  }
  return typeof value === 'number' ? value - origin : value;
}

// ── layout transitions ─────────────────────────────────────────────────────

type FramePath = (from: Frame, to: Frame, t: number) => Frame & { opacity?: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const linearPath: FramePath = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

class LinearTransitionBuilder extends ComplexAnimationBuilder {
  protected path(): FramePath {
    return linearPath;
  }

  /** @internal install on a node: Yoga frame changes animate from the drawn frame. */
  createTransition(node: HostNode): (from: Frame, to: Frame) => void {
    let run: { to: Frame; current: Frame; driver: Driver } | null = null;
    const path = this.path();
    const apply = (f: Frame & { opacity?: number }) => {
      node.x = f.x;
      node.y = f.y;
      node.w = f.w;
      node.h = f.h;
      if (f.opacity !== undefined) node.setOverrides({ opacity: f.opacity >= 0.999 ? undefined : f.opacity });
      node.engine.markPaint();
    };
    return (from, to) => {
      if (!layoutAnimationsEnabled) return;
      if (run && sameFrame(run.to, to)) {
        apply(run.current);
        return;
      }
      if (run) uiRuntime().removeDriver(run.driver);
      const start = run ? { ...run.current } : from;
      const duration = this.getDuration();
      const delay = this.getDelay();
      const easing = this.easingV ?? DEFAULT_TIMING_EASING;
      let startTime: number | null = null;
      let spring: AnimationObject | null = null;
      const state = { to, current: start, driver: null as unknown as Driver };
      state.driver = {
        step: (now) => {
          if (startTime === null) startTime = now;
          const elapsed = now - startTime - delay;
          let t = 0;
          let finished = false;
          if (elapsed >= 0) {
            if (this.springConfig) {
              if (!spring) {
                spring = springAnimation(1, this.springConfig);
                spring.onStart(0, now, null);
              }
              finished = spring.onFrame(now);
              t = finished ? 1 : (spring.current as number);
            } else {
              const raw = duration > 0 ? Math.min(1, elapsed / duration) : 1;
              finished = raw >= 1;
              t = easing(raw);
            }
          }
          state.current = finished ? { ...to } : path(start, to, t);
          apply(state.current);
          if (finished) {
            run = null;
            this.callbackV?.(true);
            return false;
          }
          return true;
        },
      };
      run = state;
      apply(start);
      uiRuntime().addDriver(state.driver);
    };
  }
}

const sameFrame = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Moves horizontally first, then vertically (`.reverse()` swaps). */
class SequencedTransitionBuilder extends LinearTransitionBuilder {
  private reversed = false;
  reverse(): this {
    this.reversed = !this.reversed;
    return this;
  }
  protected override path(): FramePath {
    const first = this.reversed ? 'y' : 'x';
    return (a, b, t) => {
      const t1 = Math.min(1, t * 2);
      const t2 = Math.max(0, t * 2 - 1);
      const tx = first === 'x' ? t1 : t2;
      const ty = first === 'x' ? t2 : t1;
      return { x: lerp(a.x, b.x, tx), w: lerp(a.w, b.w, tx), y: lerp(a.y, b.y, ty), h: lerp(a.h, b.h, ty) };
    };
  }
}

/** Fades out at the old frame, then in at the new one. */
class FadingTransitionBuilder extends LinearTransitionBuilder {
  protected override path(): FramePath {
    return (a, b, t) => (t < 0.5 ? { ...a, opacity: 1 - t * 2 } : { ...b, opacity: t * 2 - 1 });
  }
}

/** Approximated as a fade between frames. */
class EntryExitTransitionBuilder extends FadingTransitionBuilder {
  static entering(_animation: unknown): EntryExitTransitionBuilder {
    return new EntryExitTransitionBuilder();
  }
  static exiting(_animation: unknown): EntryExitTransitionBuilder {
    return new EntryExitTransitionBuilder();
  }
  entering(_animation: unknown): this {
    return this;
  }
  exiting(_animation: unknown): this {
    return this;
  }
}

/** Arcs upward while moving. */
class JumpingTransitionBuilder extends LinearTransitionBuilder {
  protected override path(): FramePath {
    return (a, b, t) => {
      const f = linearPath(a, b, t);
      const height = Math.max(20, Math.abs(b.y - a.y) / 2);
      return { ...f, y: f.y - Math.sin(Math.PI * t) * height };
    };
  }
}

/** Moves along a curve: x eases in, y eases out. */
class CurvedTransitionBuilder extends LinearTransitionBuilder {
  protected override path(): FramePath {
    const ex = Easing.in(Easing.ease);
    const ey = Easing.out(Easing.ease);
    return (a, b, t) => ({ x: lerp(a.x, b.x, ex(t)), y: lerp(a.y, b.y, ey(t)), w: lerp(a.w, b.w, ex(t)), h: lerp(a.h, b.h, ey(t)) });
  }
  easingX(_easing: EasingLike): this {
    return this;
  }
  easingY(_easing: EasingLike): this {
    return this;
  }
  easingWidth(_easing: EasingLike): this {
    return this;
  }
  easingHeight(_easing: EasingLike): this {
    return this;
  }
}

export const LinearTransition = LinearTransitionBuilder as BuilderClass<typeof LinearTransitionBuilder>;
export const Layout = LinearTransition;
export const SequencedTransition = SequencedTransitionBuilder as BuilderClass<typeof SequencedTransitionBuilder>;
export const FadingTransition = FadingTransitionBuilder as BuilderClass<typeof FadingTransitionBuilder>;
export const EntryExitTransition = EntryExitTransitionBuilder as BuilderClass<typeof EntryExitTransitionBuilder>;
export const JumpingTransition = JumpingTransitionBuilder as BuilderClass<typeof JumpingTransitionBuilder>;
export const CurvedTransition = CurvedTransitionBuilder as BuilderClass<typeof CurvedTransitionBuilder>;

/** Resolve a `layout` prop (a transition class or builder) to a node transition hook, or null. */
export function layoutTransitionFor(input: unknown, node: HostNode): ((from: Frame, to: Frame) => void) | null {
  if (!input) return null;
  const isClass = typeof input === 'function' && (input === LinearTransitionBuilder || input.prototype instanceof LinearTransitionBuilder);
  const instance = isClass ? new (input as new () => LinearTransitionBuilder)() : input;
  return instance instanceof LinearTransitionBuilder ? instance.createTransition(node) : null;
}

/** Shared element transitions are not drawn by Mimicry; the builder API is accepted. */
export class SharedTransition {
  custom(_fn: unknown): this {
    return this;
  }
  progressAnimation(_fn: unknown): this {
    return this;
  }
  duration(_ms: number): this {
    return this;
  }
  reduceMotion(_value: ReduceMotionValue): this {
    return this;
  }
  defaultTransitionType(_type: unknown): this {
    return this;
  }
  registerTransition(): void {}
  unregisterTransition(): void {}
  static custom(fn: unknown) {
    return new SharedTransition().custom(fn);
  }
  static duration(ms: number) {
    return new SharedTransition().duration(ms);
  }
}
