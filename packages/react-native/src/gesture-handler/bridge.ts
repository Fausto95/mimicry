import type { GestureConfig, GestureEventData, GestureKind, GestureListener, GestureRelations, GestureTouchEvent, HostNode } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';
import { State } from './constants';

/**
 * The boundary between the gesture APIs (v2 builders, v3 hooks, legacy
 * handler components) and the engine's gesture arena. Everything above this
 * file speaks RNGH; everything below is the engine's recognizers.
 *
 * A handler is identified by its tag. Its engine listener is created once and
 * forwards to the tag's sink, which reads the *current* callbacks, so
 * re-rendering a component with fresh closures never re-creates the handler.
 */
let nextTag = 1;
export const getNextHandlerTag = (): number => nextTag++;

/** Receives a handler's events, already shaped for one API flavor. */
export interface EventSink {
  stateChange(event: GestureEventData): void;
  update(event: GestureEventData): void;
  touches?(event: GestureTouchEvent): void;
}

const sinks = new Map<number, EventSink>();

/** Create the engine handler for `tag` if it doesn't exist yet; the first sink registered for a tag is kept. */
export function ensureHandler(tag: number, kind: GestureKind, sink: () => EventSink): void {
  if (!sinks.has(tag)) sinks.set(tag, sink());
  const arena = maybeEngine()?.gestures;
  if (!arena || arena.has(tag)) return;
  const listener: GestureListener = {
    onStateChange: (e) => sinks.get(tag)?.stateChange(e),
    onUpdate: (e) => sinks.get(tag)?.update(e),
    onTouches: (e) => sinks.get(tag)?.touches?.(e),
  };
  arena.create(tag, kind, listener);
}

export function configureHandler(tag: number, config: GestureConfig, relations: GestureRelations): void {
  maybeEngine()?.gestures.configure(tag, config, relations);
}

export function attachHandler(tag: number, node: HostNode | null): void {
  maybeEngine()?.gestures.attach(tag, node);
}

export function dropHandler(tag: number): void {
  sinks.delete(tag);
  maybeEngine()?.gestures.drop(tag);
}

export function setHandlerState(tag: number, state: State): void {
  maybeEngine()?.gestures.setState(tag, state as any);
}

// ── shared helpers ─────────────────────────────────────────────────────

/** A Reanimated SharedValue (or anything shaped like one) is read for its current value. */
export function unpack<T>(value: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in (value as object)) {
    const v = value as unknown as { value: unknown; addListener?: unknown; modify?: unknown; get?: unknown };
    if (typeof v.addListener === 'function' || typeof v.modify === 'function' || typeof v.get === 'function') return v.value as T;
  }
  return value;
}

function offsets(config: GestureConfig, name: 'activeOffsetX' | 'activeOffsetY' | 'failOffsetX' | 'failOffsetY', value: unknown): void {
  const v = unpack(value);
  if (v === undefined || v === null) return;
  const start = `${name}Start` as keyof GestureConfig;
  const end = `${name}End` as keyof GestureConfig;
  if (Array.isArray(v)) {
    (config as any)[start] = unpack(v[0]);
    (config as any)[end] = unpack(v[1]);
  } else if (typeof v === 'number') {
    if (v < 0) (config as any)[start] = v;
    else (config as any)[end] = v;
  }
}

/**
 * Public configuration (v2 builder state, v3 hook config, legacy props) →
 * the engine's names. Unknown keys are ignored, like the native side does.
 */
export function toEngineConfig(kind: GestureKind, props: Record<string, any>, needsPointerData: boolean): GestureConfig {
  const p = (key: string) => unpack(props[key]);
  const config: GestureConfig = {
    enabled: p('enabled') !== false,
    shouldCancelWhenOutside: p('shouldCancelWhenOutside'),
    hitSlop: p('hitSlop'),
    manualActivation: !!p('manualActivation'),
    cancelsJSResponder: p('cancelsJSResponder') ?? p('cancelsTouchesInView'),
    needsPointerData,
  };
  switch (kind) {
    case 'pan':
      config.minDist = p('minDist') ?? p('minDistance');
      offsets(config, 'activeOffsetX', props.activeOffsetX);
      offsets(config, 'activeOffsetY', props.activeOffsetY);
      offsets(config, 'failOffsetX', props.failOffsetX);
      offsets(config, 'failOffsetY', props.failOffsetY);
      config.minVelocity = p('minVelocity');
      config.minVelocityX = p('minVelocityX');
      config.minVelocityY = p('minVelocityY');
      config.minPointers = p('minPointers');
      config.maxPointers = p('maxPointers');
      config.avgTouches = p('avgTouches') ?? p('averageTouches');
      config.activateAfterLongPress = p('activateAfterLongPress');
      break;
    case 'tap':
      config.numberOfTaps = p('numberOfTaps');
      config.maxDurationMs = p('maxDurationMs') ?? p('maxDuration');
      config.maxDelayMs = p('maxDelayMs') ?? p('maxDelay');
      config.maxDist = p('maxDist') ?? p('maxDistance');
      config.maxDeltaX = p('maxDeltaX');
      config.maxDeltaY = p('maxDeltaY');
      config.minPointers = p('minPointers');
      break;
    case 'longPress':
      config.minDurationMs = p('minDurationMs') ?? p('minDuration');
      config.maxDist = p('maxDist') ?? p('maxDistance');
      config.numberOfPointers = p('numberOfPointers');
      break;
    case 'fling':
      config.direction = p('direction');
      config.numberOfPointers = p('numberOfPointers');
      break;
    case 'native':
      config.shouldActivateOnStart = p('shouldActivateOnStart');
      config.disallowInterruption = p('disallowInterruption');
      break;
    default:
      break;
  }
  for (const key of Object.keys(config) as Array<keyof GestureConfig>) if (config[key] === undefined) delete config[key];
  return config;
}

/** The `change*` fields RNGH adds to update events (deltas since the previous update). */
export function changes(kind: GestureKind, e: GestureEventData, previous: GestureEventData | null): Record<string, number> {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  switch (kind) {
    case 'pan':
      return {
        changeX: n(e.translationX) - (previous ? n(previous.translationX) : 0),
        changeY: n(e.translationY) - (previous ? n(previous.translationY) : 0),
      };
    case 'pinch':
      return { scaleChange: previous && n(previous.scale) ? n(e.scale) / n(previous.scale) : n(e.scale) };
    case 'rotation':
      return { rotationChange: n(e.rotation) - (previous ? n(previous.rotation) : 0) };
    case 'hover':
    case 'manual':
      return { changeX: n(e.x) - (previous ? n(previous.x) : n(e.x)), changeY: n(e.y) - (previous ? n(previous.y) : n(e.y)) };
    default:
      return {};
  }
}

export const isFinished = (state: number) => state === State.END || state === State.FAILED || state === State.CANCELLED;
