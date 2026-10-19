import type { GestureEventData, GestureKind, GestureTouchEvent } from '@mimicry/engine';
import { changes, getNextHandlerTag, isFinished, setHandlerState, toEngineConfig, type EventSink } from './bridge';
import { State, TouchEventType } from './constants';

/**
 * The v2 builder API: `Gesture.Pan().minDistance(10).onUpdate(...)`.
 *
 * Gestures are plain description objects, usually re-created on every render;
 * GestureDetector keeps the native handler (and its tag) stable across renders
 * by reusing the previous tag for a gesture of the same kind in the same
 * position. Callbacks marked `'worklet'` run synchronously like any callback.
 */
type Callback = (event: any, ...rest: any[]) => void;

export interface GestureStateManager {
  begin(): void;
  activate(): void;
  fail(): void;
  end(): void;
  handlerTag: number;
}

const stateManager = (handlerTag: number): GestureStateManager => ({
  handlerTag,
  begin: () => setHandlerState(handlerTag, State.BEGAN),
  activate: () => setHandlerState(handlerTag, State.ACTIVE),
  fail: () => setHandlerState(handlerTag, State.FAILED),
  end: () => setHandlerState(handlerTag, State.END),
});

/** Something a relation can point at: a gesture, a composed gesture, or a ref to a legacy handler. */
export type GestureRef = BaseGesture | ComposedGesture | { current: { handlerTag?: number } | null } | number;

export function tagsOf(ref: GestureRef | undefined | null): number[] {
  if (ref == null) return [];
  if (typeof ref === 'number') return [ref];
  if (ref instanceof ComposedGesture) return ref.toGestureArray().map((g) => g.handlerTag);
  if (ref instanceof BaseGesture) return [ref.handlerTag];
  if ('handlerTags' in ref && Array.isArray((ref as any).handlerTags)) return (ref as any).handlerTags;
  if ('handlerTag' in ref && typeof (ref as any).handlerTag === 'number') return [(ref as any).handlerTag];
  const current = (ref as { current?: { handlerTag?: number } | null }).current;
  return typeof current?.handlerTag === 'number' ? [current.handlerTag] : [];
}

export abstract class BaseGesture {
  handlerTag = getNextHandlerTag();
  abstract readonly kind: GestureKind;
  /** builder configuration, by public property name */
  config: Record<string, any> = {};
  handlers: Partial<Record<
    'onBegin' | 'onStart' | 'onUpdate' | 'onChange' | 'onEnd' | 'onFinalize' | 'onTouchesDown' | 'onTouchesMove' | 'onTouchesUp' | 'onTouchesCancelled',
    Callback
  >> = {};
  relations = { simultaneousWith: [] as GestureRef[], requireToFail: [] as GestureRef[], blocksHandlers: [] as GestureRef[] };
  testId?: string;
  handlerName = '';

  // ── common configuration ───────────────────────────────────────────

  enabled(enabled: boolean) {
    this.config.enabled = enabled;
    return this;
  }
  shouldCancelWhenOutside(value: boolean) {
    this.config.shouldCancelWhenOutside = value;
    return this;
  }
  hitSlop(hitSlop: unknown) {
    this.config.hitSlop = hitSlop;
    return this;
  }
  /** Callbacks always run on the JS thread here; accepted for compatibility. */
  runOnJS(runOnJS: boolean) {
    this.config.runOnJS = runOnJS;
    return this;
  }
  cancelsTouchesInView(value: boolean) {
    this.config.cancelsTouchesInView = value;
    return this;
  }
  manualActivation(manual: boolean) {
    this.config.manualActivation = manual;
    return this;
  }
  activeCursor(cursor: string) {
    this.config.activeCursor = cursor;
    return this;
  }
  mouseButton(button: number) {
    this.config.mouseButton = button;
    return this;
  }
  enableContextMenu(enabled: boolean) {
    this.config.enableContextMenu = enabled;
    return this;
  }
  withTestId(id: string) {
    this.testId = id;
    return this;
  }
  /** Points a legacy handler ref at this gesture so other handlers can relate to it. */
  withRef(ref: { current: unknown }) {
    ref.current = this;
    return this;
  }

  // ── relations ──────────────────────────────────────────────────────

  simultaneousWithExternalGesture(...gestures: GestureRef[]) {
    this.relations.simultaneousWith.push(...gestures);
    return this;
  }
  requireExternalGestureToFail(...gestures: GestureRef[]) {
    this.relations.requireToFail.push(...gestures);
    return this;
  }
  blocksExternalGesture(...gestures: GestureRef[]) {
    this.relations.blocksHandlers.push(...gestures);
    return this;
  }

  // ── callbacks ──────────────────────────────────────────────────────

  onBegin(cb: Callback) {
    this.handlers.onBegin = cb;
    return this;
  }
  onStart(cb: Callback) {
    this.handlers.onStart = cb;
    return this;
  }
  onEnd(cb: (event: any, success: boolean) => void) {
    this.handlers.onEnd = cb;
    return this;
  }
  onFinalize(cb: (event: any, success: boolean) => void) {
    this.handlers.onFinalize = cb;
    return this;
  }
  onTouchesDown(cb: (event: GestureTouchEvent, manager: GestureStateManager) => void) {
    this.handlers.onTouchesDown = cb;
    return this;
  }
  onTouchesMove(cb: (event: GestureTouchEvent, manager: GestureStateManager) => void) {
    this.handlers.onTouchesMove = cb;
    return this;
  }
  onTouchesUp(cb: (event: GestureTouchEvent, manager: GestureStateManager) => void) {
    this.handlers.onTouchesUp = cb;
    return this;
  }
  onTouchesCancelled(cb: (event: GestureTouchEvent, manager: GestureStateManager) => void) {
    this.handlers.onTouchesCancelled = cb;
    return this;
  }

  // ── detector integration ───────────────────────────────────────────

  toGestureArray(): BaseGesture[] {
    return [this];
  }

  /** Configuration in the engine's terms. */
  engineConfig() {
    const h = this.handlers;
    const needsPointerData = !!(h.onTouchesDown || h.onTouchesMove || h.onTouchesUp || h.onTouchesCancelled);
    return toEngineConfig(this.kind, this.config, needsPointerData);
  }
}

/**
 * Delivers a handler's engine events to v2 callbacks. `current` returns the
 * gesture object of the latest render, so callbacks are always fresh while
 * per-gesture state (the previous update, for `onChange`) survives re-renders.
 */
export function createV2Sink(tag: number, kind: GestureKind, current: () => BaseGesture | undefined): EventSink {
  let last: GestureEventData | null = null;
  const handlers = () => current()?.handlers ?? {};
  return {
    stateChange: (e) => {
      const h = handlers();
      if (e.state === State.BEGAN) h.onBegin?.(e);
      else if (e.state === State.ACTIVE) {
        last = null;
        h.onStart?.(e);
      } else if (isFinished(e.state)) {
        const success = e.state === State.END;
        if (e.oldState === State.ACTIVE) h.onEnd?.(e, success);
        h.onFinalize?.(e, success);
        last = null;
      }
    },
    update: (e) => {
      const h = handlers();
      h.onUpdate?.(e);
      if (h.onChange) h.onChange({ ...e, ...changes(kind, e, last) });
      last = e;
    },
    touches: (e) => {
      const h = handlers();
      const manager = stateManager(tag);
      if (e.eventType === TouchEventType.TOUCHES_DOWN) h.onTouchesDown?.(e, manager);
      else if (e.eventType === TouchEventType.TOUCHES_MOVE) h.onTouchesMove?.(e, manager);
      else if (e.eventType === TouchEventType.TOUCHES_UP) h.onTouchesUp?.(e, manager);
      else if (e.eventType === TouchEventType.TOUCHES_CANCELLED) h.onTouchesCancelled?.(e, manager);
    },
  };
}

/** Gestures that report a stream of updates while active. */
export abstract class ContinousBaseGesture extends BaseGesture {
  onUpdate(cb: Callback) {
    this.handlers.onUpdate = cb;
    return this;
  }
  onChange(cb: Callback) {
    this.handlers.onChange = cb;
    return this;
  }
}

export class PanGesture extends ContinousBaseGesture {
  readonly kind = 'pan' as const;
  override handlerName = 'PanGestureHandler';
  minDistance(distance: number) {
    this.config.minDist = distance;
    return this;
  }
  activeOffsetX(offset: number | [number, number]) {
    this.config.activeOffsetX = offset;
    return this;
  }
  activeOffsetY(offset: number | [number, number]) {
    this.config.activeOffsetY = offset;
    return this;
  }
  failOffsetX(offset: number | [number, number]) {
    this.config.failOffsetX = offset;
    return this;
  }
  failOffsetY(offset: number | [number, number]) {
    this.config.failOffsetY = offset;
    return this;
  }
  minPointers(n: number) {
    this.config.minPointers = n;
    return this;
  }
  maxPointers(n: number) {
    this.config.maxPointers = n;
    return this;
  }
  minVelocity(v: number) {
    this.config.minVelocity = v;
    return this;
  }
  minVelocityX(v: number) {
    this.config.minVelocityX = v;
    return this;
  }
  minVelocityY(v: number) {
    this.config.minVelocityY = v;
    return this;
  }
  averageTouches(value: boolean) {
    this.config.avgTouches = value;
    return this;
  }
  enableTrackpadTwoFingerGesture(value: boolean) {
    this.config.enableTrackpadTwoFingerGesture = value;
    return this;
  }
  activateAfterLongPress(ms: number) {
    this.config.activateAfterLongPress = ms;
    return this;
  }
}

export class TapGesture extends BaseGesture {
  readonly kind = 'tap' as const;
  override handlerName = 'TapGestureHandler';
  numberOfTaps(n: number) {
    this.config.numberOfTaps = n;
    return this;
  }
  maxDuration(ms: number) {
    this.config.maxDurationMs = ms;
    return this;
  }
  maxDelay(ms: number) {
    this.config.maxDelayMs = ms;
    return this;
  }
  maxDistance(d: number) {
    this.config.maxDist = d;
    return this;
  }
  maxDeltaX(d: number) {
    this.config.maxDeltaX = d;
    return this;
  }
  maxDeltaY(d: number) {
    this.config.maxDeltaY = d;
    return this;
  }
  minPointers(n: number) {
    this.config.minPointers = n;
    return this;
  }
}

export class LongPressGesture extends BaseGesture {
  readonly kind = 'longPress' as const;
  override handlerName = 'LongPressGestureHandler';
  minDuration(ms: number) {
    this.config.minDurationMs = ms;
    return this;
  }
  maxDistance(d: number) {
    this.config.maxDist = d;
    return this;
  }
  numberOfPointers(n: number) {
    this.config.numberOfPointers = n;
    return this;
  }
}

export class FlingGesture extends BaseGesture {
  readonly kind = 'fling' as const;
  override handlerName = 'FlingGestureHandler';
  direction(direction: number) {
    this.config.direction = direction;
    return this;
  }
  numberOfPointers(n: number) {
    this.config.numberOfPointers = n;
    return this;
  }
}

export class PinchGesture extends ContinousBaseGesture {
  readonly kind = 'pinch' as const;
  override handlerName = 'PinchGestureHandler';
}

export class RotationGesture extends ContinousBaseGesture {
  readonly kind = 'rotation' as const;
  override handlerName = 'RotationGestureHandler';
}

export class NativeGesture extends BaseGesture {
  readonly kind = 'native' as const;
  override handlerName = 'NativeViewGestureHandler';
  shouldActivateOnStart(value: boolean) {
    this.config.shouldActivateOnStart = value;
    return this;
  }
  disallowInterruption(value: boolean) {
    this.config.disallowInterruption = value;
    return this;
  }
}

export class ManualGesture extends ContinousBaseGesture {
  readonly kind = 'manual' as const;
  override handlerName = 'ManualGestureHandler';
}

export class HoverGesture extends ContinousBaseGesture {
  readonly kind = 'hover' as const;
  override handlerName = 'HoverGestureHandler';
  effect(effect: number) {
    this.config.hoverEffect = effect;
    return this;
  }
}

/** iOS 3D Touch is gone from current hardware; this never activates (as on devices without it). */
export class ForceTouchGesture extends ContinousBaseGesture {
  readonly kind = 'manual' as const;
  override handlerName = 'ForceTouchGestureHandler';
  minForce(_force: number) {
    return this;
  }
  maxForce(_force: number) {
    return this;
  }
  feedbackOnActivation(_value: boolean) {
    return this;
  }
}

// ── composition ────────────────────────────────────────────────────────

/** Extra relations a composition adds between its members, by tag. */
export interface CompositionRelations {
  simultaneous: Map<number, Set<number>>;
  waitFor: Map<number, Set<number>>;
}

/** `Gesture.Race`: members compete; the first to activate cancels the rest. */
export class ComposedGesture {
  readonly gestures: Array<BaseGesture | ComposedGesture>;
  constructor(...gestures: Array<BaseGesture | ComposedGesture>) {
    this.gestures = gestures;
  }

  toGestureArray(): BaseGesture[] {
    return this.gestures.flatMap((g) => g.toGestureArray());
  }

  /** Relations implied by this composition (and nested ones). */
  relations(out: CompositionRelations = { simultaneous: new Map(), waitFor: new Map() }): CompositionRelations {
    for (const g of this.gestures) if (g instanceof ComposedGesture) g.relations(out);
    return out;
  }
}

const link = (map: Map<number, Set<number>>, from: number, to: number) => {
  let set = map.get(from);
  if (!set) map.set(from, (set = new Set()));
  set.add(to);
};

/** `Gesture.Simultaneous`: every member may be active at the same time as the others. */
export class SimultaneousGesture extends ComposedGesture {
  override relations(out?: CompositionRelations): CompositionRelations {
    const result = super.relations(out);
    const all = this.toGestureArray();
    for (const a of all) for (const b of all) if (a !== b) link(result.simultaneous, a.handlerTag, b.handlerTag);
    return result;
  }
}

/** `Gesture.Exclusive`: each member activates only if all earlier members failed. */
export class ExclusiveGesture extends ComposedGesture {
  override relations(out?: CompositionRelations): CompositionRelations {
    const result = super.relations(out);
    const groups = this.gestures.map((g) => g.toGestureArray());
    groups.forEach((group, i) => {
      for (const earlier of groups.slice(0, i).flat()) for (const g of group) link(result.waitFor, g.handlerTag, earlier.handlerTag);
    });
    return result;
  }
}

export const Gesture = {
  Tap: () => new TapGesture(),
  Pan: () => new PanGesture(),
  Pinch: () => new PinchGesture(),
  Rotation: () => new RotationGesture(),
  Fling: () => new FlingGesture(),
  LongPress: () => new LongPressGesture(),
  ForceTouch: () => new ForceTouchGesture(),
  Native: () => new NativeGesture(),
  Manual: () => new ManualGesture(),
  Hover: () => new HoverGesture(),
  Race: (...gestures: Array<BaseGesture | ComposedGesture>) => new ComposedGesture(...gestures),
  Simultaneous: (...gestures: Array<BaseGesture | ComposedGesture>) => new SimultaneousGesture(...gestures),
  Exclusive: (...gestures: Array<BaseGesture | ComposedGesture>) => new ExclusiveGesture(...gestures),
};
export { Gesture as GestureObjects };
