import type { HostNode } from '../../tree/node';
import {
  Direction, GestureState, type GestureConfig, type GestureKind, type GestureListener, type GestureRelations,
  type GestureStateValue, type PointerSample,
} from './types';

/**
 * Gesture recognizers: one state machine per kind, ported from the behavior of
 * react-native-gesture-handler's native handlers. A recognizer only decides
 * *when* it wants to begin, activate, end or fail; whether it is allowed to
 * (other gestures, relations, native scrolling, the JS responder) is the
 * arena's call. Coordinates arrive in window points.
 */
export interface ArenaHost {
  transition(r: Recognizer, state: GestureStateValue): void;
  tryActivate(r: Recognizer): void;
  emitUpdate(r: Recognizer): void;
  toLocal(node: HostNode, x: number, y: number): [number, number];
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** platform touch slop (pt): the default distance a pan must travel */
  readonly touchSlop: number;
}

interface Tracked {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  time: number;
  /** recent positions for velocity */
  samples: Array<{ x: number; y: number; t: number }>;
}

const VELOCITY_WINDOW_MS = 100;
const DEFAULT_RELATIONS: GestureRelations = { simultaneousWith: [], waitFor: [], blocks: [] };

export abstract class Recognizer {
  state: GestureStateValue = GestureState.UNDETERMINED;
  node: HostNode | null = null;
  config: GestureConfig = {};
  relations: GestureRelations = DEFAULT_RELATIONS;
  /** activation was requested but another handler must fail first */
  awaiting = false;
  readonly pointers = new Map<number, Tracked>();
  /** time of the first pointer down of the current gesture */
  protected startTime = 0;
  protected lastTime = 0;
  private timers = new Set<unknown>();
  /** translation accumulated before the pointer set last changed */
  private offsetX = 0;
  private offsetY = 0;
  private originX = 0;
  private originY = 0;

  constructor(
    readonly tag: number,
    readonly kind: GestureKind,
    readonly listener: GestureListener,
    protected readonly arena: ArenaHost,
  ) {}

  get enabled(): boolean {
    return this.config.enabled !== false && !!this.node?.mounted;
  }

  get finished(): boolean {
    return this.state === GestureState.END || this.state === GestureState.FAILED || this.state === GestureState.CANCELLED;
  }

  /** Default for `shouldCancelWhenOutside` (Tap and LongPress cancel, as on iOS). */
  protected get cancelsWhenOutsideByDefault(): boolean {
    return false;
  }

  get cancelsWhenOutside(): boolean {
    return this.config.shouldCancelWhenOutside ?? this.cancelsWhenOutsideByDefault;
  }

  // ── pointer input (called by the arena) ──────────────────────────────

  pointerDown(p: PointerSample): void {
    const before = this.translation();
    if (this.pointers.size === 0) {
      this.startTime = p.time;
      this.offsetX = 0;
      this.offsetY = 0;
    }
    this.pointers.set(p.id, { id: p.id, startX: p.x, startY: p.y, x: p.x, y: p.y, time: p.time, samples: [{ x: p.x, y: p.y, t: p.time }] });
    this.rebase(this.pointers.size === 1 ? { x: 0, y: 0 } : before);
    this.lastTime = p.time;
    this.onDown(p);
  }

  pointerMove(p: PointerSample): void {
    const t = this.pointers.get(p.id);
    if (!t) return;
    t.x = p.x;
    t.y = p.y;
    t.time = p.time;
    t.samples.push({ x: p.x, y: p.y, t: p.time });
    while (t.samples.length > 2 && p.time - t.samples[0]!.t > VELOCITY_WINDOW_MS) t.samples.shift();
    this.lastTime = p.time;
    this.onMove(p);
  }

  pointerUp(p: PointerSample): void {
    const t = this.pointers.get(p.id);
    if (!t) return;
    t.x = p.x;
    t.y = p.y;
    this.lastTime = p.time;
    this.onUp(p);
    const before = this.translation();
    this.pointers.delete(p.id);
    if (this.pointers.size) this.rebase(before);
  }

  /** All pointers went away without a normal release (system cancel). */
  pointerCancel(): void {
    if (this.state === GestureState.ACTIVE) this.arena.transition(this, GestureState.CANCELLED);
    else if (this.state === GestureState.BEGAN) this.arena.transition(this, GestureState.FAILED);
    this.pointers.clear();
  }

  /** The pointer left the view: a handler that cancels when outside gives up. */
  isOutside(p: PointerSample): boolean {
    if (!this.node) return true;
    const [lx, ly] = this.arena.toLocal(this.node, p.x, p.y);
    const s = normalizeHitSlop(this.config.hitSlop, this.node.w, this.node.h);
    return lx < s.left || ly < s.top || lx > s.right || ly > s.bottom;
  }

  /** Back to idle once the gesture finished and every pointer lifted. */
  reset(): void {
    for (const t of this.timers) this.arena.clearTimeout(t);
    this.timers.clear();
    this.state = GestureState.UNDETERMINED;
    this.awaiting = false;
    this.pointers.clear();
    this.onReset();
  }

  /** Called after the arena activated this handler (possibly after waiting). */
  activated(): void {}

  // ── per-kind behavior ────────────────────────────────────────────────

  protected abstract onDown(p: PointerSample): void;
  protected abstract onMove(p: PointerSample): void;
  protected abstract onUp(p: PointerSample): void;
  protected onReset(): void {}
  /** kind-specific fields of the event payload */
  protected abstract extra(): Record<string, number | boolean>;

  // ── payload ──────────────────────────────────────────────────────────

  payload(): Record<string, number | boolean> {
    const c = this.centroid();
    const [x, y] = this.node ? this.arena.toLocal(this.node, c.x, c.y) : [c.x, c.y];
    return { x, y, absoluteX: c.x, absoluteY: c.y, ...this.extra() };
  }

  // ── transitions ──────────────────────────────────────────────────────

  protected begin(): void {
    if (this.state === GestureState.UNDETERMINED) this.arena.transition(this, GestureState.BEGAN);
  }

  protected activate(): void {
    if (this.state === GestureState.BEGAN && !this.config.manualActivation) this.arena.tryActivate(this);
  }

  /** Lifted normally: active gestures end, ones that never activated fail. */
  protected end(): void {
    if (this.state === GestureState.ACTIVE) this.arena.transition(this, GestureState.END);
    else if (this.state === GestureState.BEGAN && !this.awaiting) this.arena.transition(this, GestureState.FAILED);
  }

  protected fail(): void {
    if (this.state === GestureState.ACTIVE) this.arena.transition(this, GestureState.CANCELLED);
    else if (this.state === GestureState.BEGAN) this.arena.transition(this, GestureState.FAILED);
  }

  protected update(): void {
    if (this.state === GestureState.ACTIVE) this.arena.emitUpdate(this);
  }

  protected after(ms: number, fn: () => void): void {
    const handle = this.arena.setTimeout(() => {
      this.timers.delete(handle);
      fn();
    }, ms);
    this.timers.add(handle);
  }

  protected clearTimers(): void {
    for (const t of this.timers) this.arena.clearTimeout(t);
    this.timers.clear();
  }

  // ── geometry helpers ─────────────────────────────────────────────────

  protected centroid(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const t of this.pointers.values()) {
      x += t.x;
      y += t.y;
    }
    const n = this.pointers.size || 1;
    return { x: x / n, y: y / n };
  }

  /** Movement of the pointers' centroid since the gesture began, continuous across pointer changes. */
  protected translation(): { x: number; y: number } {
    if (!this.pointers.size) return { x: this.offsetX, y: this.offsetY };
    const c = this.centroid();
    return { x: c.x - this.originX + this.offsetX, y: c.y - this.originY + this.offsetY };
  }

  private rebase(carry: { x: number; y: number }): void {
    const c = this.centroid();
    this.originX = c.x;
    this.originY = c.y;
    this.offsetX = carry.x;
    this.offsetY = carry.y;
  }

  /** Centroid velocity in points per second over the last ~100 ms. */
  protected velocity(): { x: number; y: number } {
    let vx = 0;
    let vy = 0;
    let n = 0;
    for (const t of this.pointers.values()) {
      const first = t.samples[0]!;
      const last = t.samples[t.samples.length - 1]!;
      const dt = last.t - first.t;
      if (dt > 0) {
        vx += ((last.x - first.x) / dt) * 1000;
        vy += ((last.y - first.y) / dt) * 1000;
      }
      n++;
    }
    return n ? { x: vx / n, y: vy / n } : { x: 0, y: 0 };
  }

  protected maxPointerDistance(): number {
    let max = 0;
    for (const t of this.pointers.values()) max = Math.max(max, Math.hypot(t.x - t.startX, t.y - t.startY));
    return max;
  }
}

export function normalizeHitSlop(slop: GestureConfig['hitSlop'], w: number, h: number): { left: number; top: number; right: number; bottom: number } {
  if (slop == null) return { left: 0, top: 0, right: w, bottom: h };
  if (typeof slop === 'number') return { left: -slop, top: -slop, right: w + slop, bottom: h + slop };
  const left = -(slop.left ?? slop.horizontal ?? 0);
  const right = w + (slop.right ?? slop.horizontal ?? 0);
  const top = -(slop.top ?? slop.vertical ?? 0);
  const bottom = h + (slop.bottom ?? slop.vertical ?? 0);
  return {
    left: slop.width != null && slop.left == null ? right - slop.width : left,
    right: slop.width != null && slop.right == null && slop.left != null ? left + slop.width : right,
    top: slop.height != null && slop.top == null ? bottom - slop.height : top,
    bottom: slop.height != null && slop.bottom == null && slop.top != null ? top + slop.height : bottom,
  };
}

// ── Pan ────────────────────────────────────────────────────────────────

/**
 * Pan: begins on touch, activates once the translation passes `minDist`
 * (default: the platform touch slop) or an `activeOffset`, fails when it
 * crosses a `failOffset` first. Reports translation and velocity.
 */
export class PanRecognizer extends Recognizer {
  private longPressReady = false;

  protected onDown(): void {
    if (this.pointers.size === 1) {
      this.begin();
      this.longPressReady = !this.config.activateAfterLongPress;
      if (this.config.activateAfterLongPress) {
        this.after(this.config.activateAfterLongPress, () => {
          this.longPressReady = true;
          this.check();
        });
      }
    }
    this.check();
  }

  protected onMove(): void {
    if (this.state === GestureState.ACTIVE) {
      if (this.pointers.size > (this.config.maxPointers ?? 10)) return this.end();
      this.update();
      return;
    }
    this.check();
  }

  protected onUp(): void {
    // The last finger ends the pan; with others still down it keeps going.
    if (this.pointers.size === 1) this.end();
  }

  private check(): void {
    if (this.state !== GestureState.BEGAN || this.awaiting) return;
    const c = this.config;
    const t = this.translation();
    if (this.shouldFail(t)) return this.fail();
    if (!this.longPressReady) {
      // Moving before the long press elapsed fails the gesture, like RNGH.
      if (Math.hypot(t.x, t.y) > this.arena.touchSlop) this.fail();
      return;
    }
    const pointers = this.pointers.size;
    if (pointers < (c.minPointers ?? 1) || pointers > (c.maxPointers ?? 10)) return;
    if (this.shouldActivate(t)) this.activate();
  }

  private shouldFail(t: { x: number; y: number }): boolean {
    const c = this.config;
    if (c.failOffsetXStart !== undefined && t.x < c.failOffsetXStart) return true;
    if (c.failOffsetXEnd !== undefined && t.x > c.failOffsetXEnd) return true;
    if (c.failOffsetYStart !== undefined && t.y < c.failOffsetYStart) return true;
    if (c.failOffsetYEnd !== undefined && t.y > c.failOffsetYEnd) return true;
    return false;
  }

  private shouldActivate(t: { x: number; y: number }): boolean {
    const c = this.config;
    if (c.activeOffsetXStart !== undefined && t.x < c.activeOffsetXStart) return true;
    if (c.activeOffsetXEnd !== undefined && t.x > c.activeOffsetXEnd) return true;
    if (c.activeOffsetYStart !== undefined && t.y < c.activeOffsetYStart) return true;
    if (c.activeOffsetYEnd !== undefined && t.y > c.activeOffsetYEnd) return true;
    const v = this.velocity();
    if (c.minVelocity !== undefined && Math.hypot(v.x, v.y) >= c.minVelocity) return true;
    if (c.minVelocityX !== undefined && Math.abs(v.x) >= Math.abs(c.minVelocityX) && Math.sign(v.x) === Math.sign(c.minVelocityX || v.x)) return true;
    if (c.minVelocityY !== undefined && Math.abs(v.y) >= Math.abs(c.minVelocityY) && Math.sign(v.y) === Math.sign(c.minVelocityY || v.y)) return true;
    const offsets = c.activeOffsetXStart ?? c.activeOffsetXEnd ?? c.activeOffsetYStart ?? c.activeOffsetYEnd ?? c.minVelocity ?? c.minVelocityX ?? c.minVelocityY;
    const minDist = c.minDist ?? (offsets === undefined ? this.arena.touchSlop : undefined);
    return minDist !== undefined && Math.hypot(t.x, t.y) >= minDist;
  }

  protected extra() {
    const t = this.translation();
    const v = this.velocity();
    return { translationX: t.x, translationY: t.y, velocityX: v.x, velocityY: v.y };
  }
}

// ── Tap ────────────────────────────────────────────────────────────────

/**
 * Tap: one or more quick touches without moving far. Activates and ends on
 * the last release; fails on a long hold, a long pause between taps, or
 * movement beyond maxDist / maxDeltaX / maxDeltaY.
 */
export class TapRecognizer extends Recognizer {
  private taps = 0;
  private lifted = false;
  private maxPointersSeen = 0;

  protected override get cancelsWhenOutsideByDefault(): boolean {
    return true;
  }

  protected onDown(): void {
    this.clearTimers();
    this.lifted = false;
    this.maxPointersSeen = Math.max(this.maxPointersSeen, this.pointers.size);
    this.begin();
    this.after(this.config.maxDurationMs ?? 500, () => this.fail());
  }

  protected onMove(): void {
    if (this.state !== GestureState.BEGAN) return;
    const c = this.config;
    for (const t of this.pointers.values()) {
      const dx = t.x - t.startX;
      const dy = t.y - t.startY;
      if (c.maxDeltaX !== undefined && Math.abs(dx) > c.maxDeltaX) return this.fail();
      if (c.maxDeltaY !== undefined && Math.abs(dy) > c.maxDeltaY) return this.fail();
      if (Math.hypot(dx, dy) > (c.maxDist ?? Number.POSITIVE_INFINITY)) return this.fail();
    }
  }

  protected onUp(): void {
    if (this.state !== GestureState.BEGAN || this.pointers.size > 1) return;
    this.clearTimers();
    this.taps++;
    if (this.taps >= (this.config.numberOfTaps ?? 1) && this.maxPointersSeen >= (this.config.minPointers ?? 1)) {
      this.lifted = true;
      this.activate();
      return;
    }
    this.after(this.config.maxDelayMs ?? 500, () => this.fail());
  }

  override activated(): void {
    // A tap is discrete: once allowed to activate after the finger lifted, it is over.
    if (this.lifted) this.end();
  }

  protected override onReset(): void {
    this.taps = 0;
    this.lifted = false;
    this.maxPointersSeen = 0;
  }

  protected extra() {
    return {};
  }
}

// ── Long press ─────────────────────────────────────────────────────────

/** Long press: activates after `minDurationMs` held within `maxDist`; ends on release. */
export class LongPressRecognizer extends Recognizer {
  protected override get cancelsWhenOutsideByDefault(): boolean {
    return true;
  }

  protected onDown(): void {
    if (this.pointers.size !== 1) return;
    this.begin();
    this.after(this.config.minDurationMs ?? 500, () => this.activate());
  }

  protected onMove(): void {
    if (this.state === GestureState.BEGAN && this.maxPointerDistance() > (this.config.maxDist ?? 10)) this.fail();
    else this.update();
  }

  protected onUp(): void {
    if (this.pointers.size === 1) this.end();
  }

  protected extra() {
    return { duration: Math.max(0, this.lastTime - this.startTime) };
  }
}

// ── Fling ──────────────────────────────────────────────────────────────

const FLING_MIN_DISTANCE = 50;
const FLING_MIN_VELOCITY = 700;
const FLING_MAX_DURATION_MS = 1000;

/** Fling: a quick swipe in an allowed direction; activates and ends at once. */
export class FlingRecognizer extends Recognizer {
  protected onDown(): void {
    if (this.pointers.size !== 1) return;
    this.begin();
    this.after(FLING_MAX_DURATION_MS, () => this.fail());
  }

  protected onMove(): void {
    if (this.state !== GestureState.BEGAN || this.pointers.size !== (this.config.numberOfPointers ?? 1)) return;
    const t = this.translation();
    const v = this.velocity();
    const allowed = this.config.direction ?? Direction.RIGHT;
    const hits = (dir: number, distance: number, speed: number) => (allowed & dir) !== 0 && distance >= FLING_MIN_DISTANCE && speed >= FLING_MIN_VELOCITY;
    const horizontal = Math.abs(t.x) >= Math.abs(t.y);
    const matched = horizontal
      ? hits(Direction.RIGHT, t.x, v.x) || hits(Direction.LEFT, -t.x, -v.x)
      : hits(Direction.DOWN, t.y, v.y) || hits(Direction.UP, -t.y, -v.y);
    if (matched) this.activate();
  }

  override activated(): void {
    this.end();
  }

  protected onUp(): void {
    if (this.pointers.size === 1) this.end();
  }

  protected extra() {
    return {};
  }
}

// ── Two-finger gestures ────────────────────────────────────────────────

abstract class TwoPointerRecognizer extends Recognizer {
  protected startSpan = 0;
  protected startAngle = 0;
  protected lastValue = 0;
  protected lastValueTime = 0;
  protected valueVelocity = 0;

  protected pair(): [Tracked, Tracked] | null {
    const list = Array.from(this.pointers.values());
    return list.length >= 2 ? [list[0]!, list[1]!] : null;
  }

  protected span(): number {
    const p = this.pair();
    return p ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 0;
  }

  protected angle(): number {
    const p = this.pair();
    return p ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0;
  }

  protected abstract value(): number;
  protected abstract passedThreshold(): boolean;

  protected onDown(): void {
    this.begin();
    if (this.pointers.size === 2) {
      this.startSpan = this.span();
      this.startAngle = this.angle();
      this.lastValue = this.value();
      this.lastValueTime = this.lastTime;
    }
  }

  protected onMove(): void {
    if (this.pointers.size < 2) return;
    const v = this.value();
    const dt = this.lastTime - this.lastValueTime;
    if (dt > 0) this.valueVelocity = ((v - this.lastValue) / dt) * 1000;
    this.lastValue = v;
    this.lastValueTime = this.lastTime;
    if (this.state === GestureState.BEGAN && this.passedThreshold()) this.activate();
    else this.update();
  }

  protected onUp(): void {
    if (this.pointers.size <= 2) this.end();
  }

  protected override onReset(): void {
    this.valueVelocity = 0;
  }

  protected focal(): { x: number; y: number } {
    const c = this.centroid();
    return this.node ? (([x, y]) => ({ x, y }))(this.arena.toLocal(this.node, c.x, c.y)) : c;
  }
}

/** Pinch: the distance between two fingers; `scale` is relative to where they started. */
export class PinchRecognizer extends TwoPointerRecognizer {
  protected value(): number {
    return this.startSpan > 0 ? this.span() / this.startSpan : 1;
  }

  protected passedThreshold(): boolean {
    return Math.abs(this.span() - this.startSpan) >= this.arena.touchSlop;
  }

  protected extra() {
    const f = this.focal();
    return { scale: this.pointers.size >= 2 ? this.value() : this.lastValue || 1, focalX: f.x, focalY: f.y, velocity: this.valueVelocity };
  }
}

const ROTATION_SLOP = (5 * Math.PI) / 180;

/** Rotation: the angle of the line between two fingers, in radians, relative to the start. */
export class RotationRecognizer extends TwoPointerRecognizer {
  protected value(): number {
    let d = this.angle() - this.startAngle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  protected passedThreshold(): boolean {
    return Math.abs(this.value()) >= ROTATION_SLOP;
  }

  protected extra() {
    const f = this.focal();
    return { rotation: this.pointers.size >= 2 ? this.value() : this.lastValue, anchorX: f.x, anchorY: f.y, velocity: this.valueVelocity };
  }
}

// ── Native, manual, hover ──────────────────────────────────────────────

/**
 * Native: the gesture a native view already has. On a scroll view it is the
 * scroll itself — the arena activates it when the scroll view starts
 * dragging and ends it when the drag ends. On other views it begins on touch
 * and activates on start (`shouldActivateOnStart`) or on release inside.
 */
export class NativeRecognizer extends Recognizer {
  get wrapsScroll(): boolean {
    return this.node?.kind === 'scroll';
  }

  protected onDown(): void {
    if (this.pointers.size !== 1) return;
    this.begin();
    if (!this.wrapsScroll && this.config.shouldActivateOnStart) this.activate();
  }

  protected onMove(p: PointerSample): void {
    if (!this.wrapsScroll && this.state === GestureState.BEGAN && this.isOutside(p)) this.fail();
    else this.update();
  }

  protected onUp(p: PointerSample): void {
    if (this.pointers.size !== 1) return;
    if (this.wrapsScroll) {
      // A scroll view that never dragged was only touched.
      if (this.state === GestureState.BEGAN) this.fail();
      return;
    }
    if (this.state === GestureState.BEGAN && !this.isOutside(p)) {
      this.activate();
      this.end();
    } else this.end();
  }

  /** The wrapped scroll view started or finished dragging. */
  scrollStarted(): void {
    this.begin();
    this.activate();
  }

  scrollEnded(): void {
    this.end();
  }

  protected extra() {
    return { pointerInside: true };
  }
}

/** Manual: never activates by itself; the app drives it through the state manager. */
export class ManualRecognizer extends Recognizer {
  protected onDown(): void {
    if (this.pointers.size === 1) this.begin();
  }

  protected onMove(): void {
    this.update();
  }

  protected onUp(): void {
    if (this.pointers.size === 1 && this.state === GestureState.BEGAN) this.fail();
  }

  protected extra() {
    return {};
  }
}

/**
 * Hover needs a hovering pointer (mouse without buttons, stylus). The frame
 * protocol only carries touches, so hover gestures never begin.
 */
export class HoverRecognizer extends Recognizer {
  protected onDown(): void {}
  protected onMove(): void {}
  protected onUp(): void {}
  protected extra() {
    return {};
  }
}

export function createRecognizer(tag: number, kind: GestureKind, listener: GestureListener, arena: ArenaHost): Recognizer {
  switch (kind) {
    case 'pan':
      return new PanRecognizer(tag, kind, listener, arena);
    case 'tap':
      return new TapRecognizer(tag, kind, listener, arena);
    case 'longPress':
      return new LongPressRecognizer(tag, kind, listener, arena);
    case 'fling':
      return new FlingRecognizer(tag, kind, listener, arena);
    case 'pinch':
      return new PinchRecognizer(tag, kind, listener, arena);
    case 'rotation':
      return new RotationRecognizer(tag, kind, listener, arena);
    case 'native':
      return new NativeRecognizer(tag, kind, listener, arena);
    case 'manual':
      return new ManualRecognizer(tag, kind, listener, arena);
    case 'hover':
      return new HoverRecognizer(tag, kind, listener, arena);
  }
}
