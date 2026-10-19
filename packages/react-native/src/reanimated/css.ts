import type { HostNode } from '@mimicry/react-native-fabric';
import { Easing, type EasingFunction } from './easing';
import { addKeyframe, emptyTimeline, playTimeline, type Timeline, type TimelineRun } from './timeline';

/**
 * Reanimated 4 CSS animations and transitions: `animationName` keyframes and
 * `transition*` style props on Animated components, played as keyframe
 * timelines on the host node (CSS semantics: a keyframe's timing function
 * applies to the segment that starts at it).
 */

// ── timing functions ───────────────────────────────────────────────────────

export class CubicBezierEasing {
  constructor(readonly x1: number, readonly y1: number, readonly x2: number, readonly y2: number) {}
  toEasing(): EasingFunction {
    return Easing.bezierFn(this.x1, this.y1, this.x2, this.y2);
  }
  toString(): string {
    return `cubic-bezier(${this.x1}, ${this.y1}, ${this.x2}, ${this.y2})`;
  }
}

export class StepsEasing {
  constructor(readonly stepsNumber: number, readonly modifier: 'jump-start' | 'start' | 'jump-end' | 'end' | 'jump-none' | 'jump-both' = 'jump-end') {}
  toEasing(): EasingFunction {
    const n = this.stepsNumber;
    const m = this.modifier;
    return (t) => {
      if (m === 'jump-none') return Math.min(1, Math.floor(t * n) / Math.max(1, n - 1));
      if (m === 'jump-both') return Math.min(1, (Math.floor(t * n) + 1) / (n + 1));
      if (m === 'jump-start' || m === 'start') return Math.min(1, Math.ceil(t * n) / n);
      return Math.floor(t * n) / n;
    };
  }
  toString(): string {
    return `steps(${this.stepsNumber}, ${this.modifier})`;
  }
}

export class LinearEasing {
  readonly points: Array<[number, number]>;
  constructor(points: Array<number | [number, string | number]>) {
    const n = points.length;
    this.points = points.map((p, i) => {
      if (Array.isArray(p)) return [p[0], typeof p[1] === 'string' ? parseFloat(p[1]) / 100 : p[1]];
      return [p, n > 1 ? i / (n - 1) : 0];
    }).map(([value, x]) => [x as number, value as number]);
  }
  toEasing(): EasingFunction {
    const pts = this.points;
    return (t) => {
      if (pts.length < 2) return t;
      let i = 1;
      while (i < pts.length - 1 && t > pts[i]![0]) i++;
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      return x1 === x0 ? y1 : y0 + ((t - x0) / (x1 - x0)) * (y1 - y0);
    };
  }
}

export const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => new CubicBezierEasing(x1, y1, x2, y2);
export const steps = (n: number, modifier?: StepsEasing['modifier']) => new StepsEasing(n, modifier);
export const linear = (...points: Array<number | [number, string | number]>) => new LinearEasing(points);

const NAMED: Record<string, EasingFunction> = {
  linear: (t) => t,
  ease: Easing.bezierFn(0.25, 0.1, 0.25, 1),
  'ease-in': Easing.bezierFn(0.42, 0, 1, 1),
  'ease-out': Easing.bezierFn(0, 0, 0.58, 1),
  'ease-in-out': Easing.bezierFn(0.42, 0, 0.58, 1),
  'step-start': steps(1, 'jump-start').toEasing(),
  'step-end': steps(1, 'jump-end').toEasing(),
};

function timingFunction(value: unknown): EasingFunction {
  if (typeof value === 'string') return NAMED[value] ?? NAMED.ease!;
  if (value && typeof (value as { toEasing?: unknown }).toEasing === 'function') return (value as { toEasing(): EasingFunction }).toEasing();
  if (typeof value === 'function') return value as EasingFunction;
  return NAMED.ease!;
}

function time(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return fallback;
    return value.trim().endsWith('ms') ? n : value.trim().endsWith('s') ? n * 1000 : n;
  }
  return fallback;
}

const pick = <T>(value: T | T[] | undefined, index: number): T | undefined => (Array.isArray(value) ? value[index % value.length] : value);

// ── keyframes ──────────────────────────────────────────────────────────────

type Style = Record<string, unknown>;
export interface CSSKeyframesRule {
  readonly __cssKeyframes: true;
  readonly name: string;
  readonly keyframes: Record<string, Style>;
}

let nextKeyframes = 1;
export function keyframes(definition: Record<string, Style>): CSSKeyframesRule {
  return { __cssKeyframes: true, name: `mimicry-keyframes-${nextKeyframes++}`, keyframes: definition };
}

export const css = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  keyframes,
};

const ANIMATION_PROPS = [
  'animationName', 'animationDuration', 'animationDelay', 'animationTimingFunction', 'animationIterationCount',
  'animationDirection', 'animationFillMode', 'animationPlayState',
];
const TRANSITION_PROPS = ['transitionProperty', 'transitionDuration', 'transitionDelay', 'transitionTimingFunction', 'transitionBehavior'];
export const CSS_PROPS = new Set([...ANIMATION_PROPS, ...TRANSITION_PROPS]);

/** What a property is when no keyframe says (implicit from/to): the view's own style. */
function baseValue(key: string, style: Style): unknown {
  if (key.startsWith('transform:')) {
    const fn = key.slice('transform:'.length);
    const own = Array.isArray(style.transform) ? (style.transform as Style[]).find((t) => fn in t)?.[fn] : undefined;
    if (own !== undefined) return own;
    return /^scale/.test(fn) ? 1 : /^(rotate|skew)/.test(fn) ? '0deg' : 0;
  }
  if (key in style) return style[key];
  return key === 'opacity' ? 1 : undefined;
}

function keyframesTimeline(rule: Record<string, Style>, style: Style): Timeline {
  const timeline = emptyTimeline({ easingAt: 'start' });
  for (const [selector, frame] of Object.entries(rule)) {
    const offsets = selector.split(',').map((s) => s.trim()).map((s) => (s === 'from' ? 0 : s === 'to' ? 1 : parseFloat(s) / 100));
    const { animationTimingFunction, ...props } = frame;
    for (const offset of offsets) addKeyframe(timeline, offset, props, animationTimingFunction ? timingFunction(animationTimingFunction) : undefined);
  }
  for (const [key, stops] of timeline.tracks) {
    if (stops[0]!.offset > 0) stops.unshift({ offset: 0, value: baseValue(key, style) });
    if (stops[stops.length - 1]!.offset < 1) stops.push({ offset: 1, value: baseValue(key, style) });
  }
  return timeline;
}

// ── per-component controller ───────────────────────────────────────────────

/**
 * Owned by one Animated component: starts/stops CSS animations when the
 * animation props change and runs transitions when transitioned style values
 * change between renders.
 */
export class CSSController {
  private animationKey = '';
  private animations: TimelineRun[] = [];
  private previous: Style | null = null;
  private readonly transitions = new Map<string, TimelineRun>();

  sync(node: HostNode, style: Style): void {
    this.syncAnimations(node, style);
    this.syncTransitions(node, style);
    this.previous = style;
  }

  dispose(): void {
    for (const run of this.animations) run.cancel();
    for (const run of this.transitions.values()) run.cancel();
    this.animations = [];
    this.transitions.clear();
  }

  private syncAnimations(node: HostNode, style: Style): void {
    const names = style.animationName;
    const key = names && names !== 'none' ? JSON.stringify(ANIMATION_PROPS.map((p) => serialize(style[p]))) : '';
    if (key === this.animationKey) return;
    this.animationKey = key;
    for (const run of this.animations) run.cancel();
    this.animations = [];
    if (!key || style.animationPlayState === 'paused') return;
    const list = (Array.isArray(names) ? names : [names]) as Array<CSSKeyframesRule | Record<string, Style>>;
    list.forEach((entry, i) => {
      const rule = (entry as CSSKeyframesRule).__cssKeyframes ? (entry as CSSKeyframesRule).keyframes : (entry as Record<string, Style>);
      const timeline = keyframesTimeline(rule, style);
      const count = pick(style.animationIterationCount as number | string | Array<number | string>, i);
      timeline.duration = time(pick(style.animationDuration as unknown, i), 0);
      timeline.delay = time(pick(style.animationDelay as unknown, i), 0);
      timeline.easing = timingFunction(pick(style.animationTimingFunction as unknown, i));
      timeline.iterations = count === 'infinite' ? Infinity : typeof count === 'number' ? count : 1;
      timeline.direction = (pick(style.animationDirection as string, i) as Timeline['direction']) ?? 'normal';
      timeline.fill = (pick(style.animationFillMode as string, i) as Timeline['fill']) ?? 'none';
      this.animations.push(playTimeline(node, timeline));
    });
  }

  private syncTransitions(node: HostNode, style: Style): void {
    const previous = this.previous;
    const property = style.transitionProperty;
    if (!previous || property == null || property === 'none') return;
    const properties = (Array.isArray(property) ? property : [property]) as string[];
    const all = properties.includes('all');
    const keys = new Set([...Object.keys(previous), ...Object.keys(style)]);
    for (const key of keys) {
      if (CSS_PROPS.has(key)) continue;
      const index = all ? properties.indexOf('all') : properties.indexOf(key);
      if (index < 0) continue;
      const from = node.overrides?.[key] ?? previous[key];
      const to = style[key];
      if (serialize(from) === serialize(to) || from === undefined || to === undefined) continue;
      this.transitions.get(key)?.cancel();
      const timeline = emptyTimeline({
        easingAt: 'start',
        duration: time(pick(style.transitionDuration as unknown, index), 0),
        delay: time(pick(style.transitionDelay as unknown, index), 0),
        easing: timingFunction(pick(style.transitionTimingFunction as unknown, index) ?? 'ease'),
      });
      if (timeline.duration <= 0) continue;
      addKeyframe(timeline, 0, { [key]: from });
      addKeyframe(timeline, 1, { [key]: to });
      this.transitions.set(key, playTimeline(node, timeline, { applyStartNow: true, onEnd: () => this.transitions.delete(key) }));
    }
  }
}

function serialize(value: unknown): string {
  if (value && typeof value === 'object' && (value as CSSKeyframesRule).__cssKeyframes) return (value as CSSKeyframesRule).name;
  if (value && typeof value === 'object' && typeof (value as { toString?: unknown }).toString === 'function' && !(Array.isArray(value)) && Object.getPrototypeOf(value) !== Object.prototype) {
    return String(value);
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function hasCSS(style: Style): boolean {
  for (const key of Object.keys(style)) if (CSS_PROPS.has(key)) return true;
  return false;
}
