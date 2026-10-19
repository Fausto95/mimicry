import type { HostNode } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';
import { springAnimation, type AnimationObject, type WithSpringConfig } from './animations';
import type { EasingFunction } from './easing';
import { uiRuntime, type Driver } from './runtime';
import { isColorLike, rgbaComponents, rgbaString } from './values';
import { parseColor } from '@mimicry/engine';

/**
 * Keyframe timelines on a host node: the one engine behind Reanimated
 * layout animations (presets and `Keyframe`) and Reanimated 4 CSS
 * animations/transitions. A timeline is a set of per-property tracks of
 * stops (offset 0..1 → value); each frame the node's style overrides are set
 * to the tracks evaluated at the current progress — the same mechanism as
 * the native driver, no React render involved.
 */
export interface Stop {
  offset: number;
  value: unknown;
  /** easing for the segment that ends (Keyframe) or starts (CSS) at this stop */
  easing?: EasingFunction;
}

export interface Timeline {
  /** style key, or `transform:<fn>` for one transform function */
  tracks: Map<string, Stop[]>;
  /** order of transform functions in the composed transform array */
  transformOrder: string[];
  duration: number;
  delay: number;
  easing: EasingFunction;
  /** Reanimated Keyframe easings apply to the segment ending at a stop; CSS to the one starting there */
  easingAt: 'end' | 'start';
  iterations: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill: 'none' | 'forwards' | 'backwards' | 'both';
  /** drive progress with a spring instead of duration/easing (`.springify()`) */
  spring?: WithSpringConfig;
}

export function emptyTimeline(partial: Partial<Timeline> = {}): Timeline {
  return {
    tracks: new Map(),
    transformOrder: [],
    duration: 300,
    delay: 0,
    easing: (t) => t,
    easingAt: 'end',
    iterations: 1,
    direction: 'normal',
    fill: 'none',
    ...partial,
  };
}

/** Add a keyframe's style (incl. its transform array) at `offset`. */
export function addKeyframe(timeline: Timeline, offset: number, style: Record<string, unknown>, easing?: EasingFunction): void {
  for (const [key, value] of Object.entries(style)) {
    if (key === 'easing' || value === undefined) continue;
    if (key === 'transform' && Array.isArray(value)) {
      for (const item of value) {
        for (const [fn, v] of Object.entries(item as Record<string, unknown>)) {
          if (!timeline.transformOrder.includes(fn)) timeline.transformOrder.push(fn);
          pushStop(timeline, `transform:${fn}`, { offset, value: v, easing });
        }
      }
    } else {
      pushStop(timeline, key, { offset, value, easing });
    }
  }
}

function pushStop(timeline: Timeline, key: string, stop: Stop): void {
  let stops = timeline.tracks.get(key);
  if (!stops) timeline.tracks.set(key, (stops = []));
  const existing = stops.findIndex((s) => s.offset === stop.offset);
  if (existing >= 0) stops[existing] = stop;
  else stops.push(stop);
  stops.sort((a, b) => a.offset - b.offset);
}

// ── value resolution ───────────────────────────────────────────────────────

interface Resolved {
  components: number[];
  build(c: number[]): unknown;
}

const ANGLE = /^(-?\d*\.?\d+)(deg|rad|turn)$/;
const LENGTH = /^(-?\d*\.?\d+)(px|%|vw|vh)?$/;

/** Resolve units against the node and window (100% of translateX = own width). */
function resolveValue(key: string, value: unknown, node: HostNode): Resolved {
  if (typeof value === 'number') return { components: [value], build: (c) => c[0] };
  if (typeof value === 'string') {
    const s = value.trim();
    const angle = ANGLE.exec(s);
    if (angle) {
      const n = parseFloat(angle[1]!);
      const deg = angle[2] === 'rad' ? (n * 180) / Math.PI : angle[2] === 'turn' ? n * 360 : n;
      return { components: [deg], build: (c) => `${c[0]}deg` };
    }
    const length = LENGTH.exec(s);
    if (length) {
      const n = parseFloat(length[1]!);
      const v = maybeEngine()?.viewport;
      const vertical = /Y$|^top$|^bottom$|height/i.test(key.replace('transform:', ''));
      let px = n;
      if (length[2] === '%') {
        if (key.startsWith('transform:')) px = (n / 100) * (vertical ? node.h : node.w);
        else return { components: [n], build: (c) => `${c[0]}%` };
      } else if (length[2] === 'vw') px = (n / 100) * (v?.width ?? 0);
      else if (length[2] === 'vh') px = (n / 100) * (v?.height ?? 0);
      return { components: [px], build: (c) => c[0] };
    }
    if (isColorLike(s)) {
      const packed = parseColor(s, maybeEngine()?.colorContext) ?? 0;
      return { components: rgbaComponents(packed), build: (c) => rgbaString(c[0]!, c[1]!, c[2]!, c[3]!) };
    }
  }
  return { components: [], build: () => value };
}

/** Value of a track at progress p (0..1, may overshoot for springs). */
function sample(timeline: Timeline, stops: Array<Stop & { resolved: Resolved }>, p: number): unknown {
  if (stops.length === 1) return stops[0]!.resolved.build(stops[0]!.resolved.components);
  let i = 1;
  while (i < stops.length - 1 && p > stops[i]!.offset) i++;
  const a = stops[i - 1]!;
  const b = stops[i]!;
  if (!a.resolved.components.length || a.resolved.components.length !== b.resolved.components.length) {
    return p < b.offset ? a.value : b.value;
  }
  const span = b.offset - a.offset;
  let t = span > 0 ? (p - a.offset) / span : 1;
  if (p >= 0 && p <= 1) {
    const easing = (timeline.easingAt === 'end' ? b.easing : a.easing) ?? (timeline.spring ? (x: number) => x : timeline.easing);
    t = easing(Math.min(1, Math.max(0, t)));
  }
  return a.resolved.build(a.resolved.components.map((x, j) => x + (b.resolved.components[j]! - x) * t));
}

/** Style values for the whole timeline at progress p. */
export function evaluate(timeline: Timeline, resolved: Map<string, Array<Stop & { resolved: Resolved }>>, p: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const transform: Array<Record<string, unknown>> = [];
  for (const fn of timeline.transformOrder) {
    const stops = resolved.get(`transform:${fn}`);
    if (stops) transform.push({ [fn]: sample(timeline, stops, p) });
  }
  for (const [key, stops] of resolved) {
    if (!key.startsWith('transform:')) out[key] = sample(timeline, stops, p);
  }
  if (transform.length) out.transform = transform;
  return out;
}

export function resolveTimeline(timeline: Timeline, node: HostNode): Map<string, Array<Stop & { resolved: Resolved }>> {
  const out = new Map<string, Array<Stop & { resolved: Resolved }>>();
  for (const [key, stops] of timeline.tracks) {
    out.set(key, stops.map((s) => ({ ...s, resolved: resolveValue(key, s.value, node) })));
  }
  return out;
}

// ── running ────────────────────────────────────────────────────────────────

export interface TimelineRun {
  cancel(): void;
  readonly finished: boolean;
}

/**
 * Play a timeline on a node. The first frame (fill backwards, or the 0%
 * keyframe for layout animations) is applied immediately so nothing flashes.
 * `onEnd(finished)` runs when it completes or is cancelled.
 */
export function playTimeline(
  node: HostNode,
  timeline: Timeline,
  options: { applyStartNow?: boolean; onEnd?: (finished: boolean) => void } = {},
): TimelineRun {
  const runtime = uiRuntime();
  const resolved = resolveTimeline(timeline, node);
  const keys = new Set<string>();
  for (const key of timeline.tracks.keys()) keys.add(key.startsWith('transform:') ? 'transform' : key);
  let start: number | null = null;
  let spring: AnimationObject | null = null;
  let done = false;
  const total = timeline.iterations === Infinity ? Infinity : timeline.duration * timeline.iterations;

  const apply = (p: number) => {
    if (!node.mounted && !node.exiting) return;
    node.setOverrides(evaluate(timeline, resolved, p));
  };
  const progressAt = (elapsed: number): number => {
    const d = timeline.duration;
    if (d <= 0) return directed(timeline, 0, 1);
    const iteration = Math.min(Math.floor(elapsed / d), timeline.iterations - 1);
    const local = elapsed >= total ? 1 : (elapsed - iteration * d) / d;
    return directed(timeline, iteration, local);
  };
  const finish = (finished: boolean) => {
    if (done) return;
    done = true;
    runtime.removeDriver(driver);
    const keep = timeline.fill === 'forwards' || timeline.fill === 'both';
    if (finished && keep) apply(timeline.spring ? 1 : progressAt(total));
    else if (node.mounted || node.exiting) {
      const clear: Record<string, unknown> = {};
      for (const k of keys) clear[k] = undefined;
      node.setOverrides(clear);
    }
    options.onEnd?.(finished);
  };

  const driver: Driver = {
    step(now) {
      if (done) return false;
      if (start === null) start = now;
      const elapsed = now - start - timeline.delay;
      if (elapsed < 0) return true;
      if (timeline.spring) {
        if (!spring) {
          spring = springAnimation(1, timeline.spring);
          spring.onStart(0, now, null);
        }
        const settled = spring.onFrame(now);
        apply(settled ? 1 : (spring.current as number));
        if (settled) finish(true);
        return !done;
      }
      if (elapsed >= total) {
        apply(progressAt(total));
        finish(true);
        return false;
      }
      apply(progressAt(elapsed));
      return true;
    },
  };

  if (options.applyStartNow || timeline.fill === 'backwards' || timeline.fill === 'both') apply(directed(timeline, 0, 0));
  runtime.addDriver(driver);
  return {
    cancel: () => finish(false),
    get finished() {
      return done;
    },
  };
}

function directed(timeline: Timeline, iteration: number, local: number): number {
  const reverse =
    timeline.direction === 'reverse' ||
    (timeline.direction === 'alternate' && iteration % 2 === 1) ||
    (timeline.direction === 'alternate-reverse' && iteration % 2 === 0);
  return reverse ? 1 - local : local;
}
