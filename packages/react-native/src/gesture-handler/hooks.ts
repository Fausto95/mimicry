import { useEffect, useMemo } from 'react';
import type { GestureEventData, GestureKind } from '@mimicry/engine';
import { changes, dropHandler, ensureHandler, getNextHandlerTag, isFinished, setHandlerState, toEngineConfig, unpack, type EventSink } from './bridge';
import { State, TouchEventType } from './constants';

/**
 * The v3 hook API: `const pan = usePanGesture({ minDistance: 10, onUpdate })`.
 *
 * A hook owns its handler: the tag is created on mount and dropped on
 * unmount; GestureDetector only attaches it to a view. Config values may be
 * Reanimated shared values, which are read when the handler is configured.
 */
const SINGLE_NAMES: Record<GestureKind, string> = {
  tap: 'TapGestureHandler',
  longPress: 'LongPressGestureHandler',
  pan: 'PanGestureHandler',
  pinch: 'PinchGestureHandler',
  rotation: 'RotationGestureHandler',
  fling: 'FlingGestureHandler',
  manual: 'ManualGestureHandler',
  native: 'NativeViewGestureHandler',
  hover: 'HoverGestureHandler',
};

export interface SingleGesture {
  handlerTag: number;
  type: string;
  kind: GestureKind;
  config: Record<string, any>;
}

export interface ComposedGesture {
  handlerTags: number[];
  type: 'SimultaneousGesture' | 'ExclusiveGesture' | 'CompetingGesture';
  gestures: AnyGesture[];
  config: Record<string, unknown>;
}

export type AnyGesture = SingleGesture | ComposedGesture;

export const isV3Single = (g: unknown): g is SingleGesture =>
  !!g && typeof g === 'object' && typeof (g as SingleGesture).handlerTag === 'number' && typeof (g as SingleGesture).kind === 'string' && 'config' in (g as object);
export const isV3Composed = (g: unknown): g is ComposedGesture => !!g && typeof g === 'object' && Array.isArray((g as ComposedGesture).handlerTags) && Array.isArray((g as ComposedGesture).gestures);

/** The latest gesture object per tag, so events always reach the latest callbacks. */
const latest = new Map<number, SingleGesture>();

export function v3Leaves(g: AnyGesture): SingleGesture[] {
  return isV3Composed(g) ? g.gestures.flatMap(v3Leaves) : [g];
}

/** Tags a v3 relation value points at. */
export function v3Tags(value: unknown): number[] {
  const v = unpack(value);
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(v3Tags);
  if (isV3Composed(v)) return v.handlerTags;
  if (typeof (v as { handlerTag?: unknown }).handlerTag === 'number') return [(v as { handlerTag: number }).handlerTag];
  return [];
}

function useSingleGesture(kind: GestureKind, config: Record<string, any>): SingleGesture {
  const handlerTag = useMemo(getNextHandlerTag, []);
  const gesture = useMemo<SingleGesture>(() => ({ handlerTag, type: SINGLE_NAMES[kind], kind, config }), [handlerTag, kind, config]);
  latest.set(handlerTag, gesture);
  useEffect(() => {
    ensureHandler(handlerTag, kind, () => v3Sink(handlerTag, kind));
    return () => {
      latest.delete(handlerTag);
      dropHandler(handlerTag);
    };
  }, [handlerTag, kind]);
  return gesture;
}

/** The sink that turns engine events into v3 callbacks (flattened events, onActivate/onDeactivate). */
const v3State = new Map<number, GestureEventData | null>();
export function v3Sink(tag: number, kind: GestureKind): EventSink {
  const flatten = (e: GestureEventData) => {
    const { state: _s, oldState: _o, ...rest } = e;
    return rest;
  };
  const config = () => latest.get(tag)?.config ?? {};
  return {
    stateChange: (e) => {
      const c = config();
      if (e.state === State.BEGAN) c.onBegin?.(flatten(e));
      else if (e.state === State.ACTIVE) {
        v3State.set(tag, null);
        c.onActivate?.(flatten(e));
      } else if (isFinished(e.state)) {
        const end = { ...flatten(e), canceled: e.state !== State.END };
        if (e.oldState === State.ACTIVE) c.onDeactivate?.(end);
        c.onFinalize?.(end);
        v3State.delete(tag);
      }
    },
    update: (e) => {
      const c = config();
      const onUpdate = c.onUpdate;
      if (!onUpdate) return;
      const event = { ...flatten(e), ...changes(kind, e, v3State.get(tag) ?? null) };
      v3State.set(tag, e);
      // Animated.event mappings address the native event: { nativeEvent: { handlerData } }.
      if (c.useAnimated || (onUpdate as { __isAnimatedEvent?: boolean }).__isAnimatedEvent) {
        onUpdate({ nativeEvent: { handlerTag: tag, state: e.state, handlerData: event } });
      } else onUpdate(event);
    },
    touches: (e) => {
      const c = config();
      const map: Record<number, string> = {
        [TouchEventType.TOUCHES_DOWN]: 'onTouchesDown',
        [TouchEventType.TOUCHES_MOVE]: 'onTouchesMove',
        [TouchEventType.TOUCHES_UP]: 'onTouchesUp',
        [TouchEventType.TOUCHES_CANCELLED]: 'onTouchesCancel',
      };
      c[map[e.eventType]!]?.(e);
    },
  };
}

/** Engine configuration and relation tags for a v3 gesture. */
export function v3EngineConfig(g: SingleGesture) {
  const c = g.config;
  const needsPointerData = !!(c.onTouchesDown || c.onTouchesMove || c.onTouchesUp || c.onTouchesCancel);
  return toEngineConfig(g.kind, c, needsPointerData);
}

export const useTapGesture = (config: Record<string, any> = {}) => useSingleGesture('tap', config);
export const usePanGesture = (config: Record<string, any> = {}) => useSingleGesture('pan', config);
export const useLongPressGesture = (config: Record<string, any> = {}) => useSingleGesture('longPress', config);
export const useFlingGesture = (config: Record<string, any> = {}) => useSingleGesture('fling', config);
export const usePinchGesture = (config: Record<string, any> = {}) => useSingleGesture('pinch', config);
export const useRotationGesture = (config: Record<string, any> = {}) => useSingleGesture('rotation', config);
export const useNativeGesture = (config: Record<string, any> = {}) => useSingleGesture('native', config);
export const useManualGesture = (config: Record<string, any> = {}) => useSingleGesture('manual', config);
export const useHoverGesture = (config: Record<string, any> = {}) => useSingleGesture('hover', config);

function useComposed(type: ComposedGesture['type'], gestures: AnyGesture[]): ComposedGesture {
  const flat = gestures.flatMap((g) => (isV3Composed(g) && g.type === type ? g.gestures : [g]));
  const handlerTags = flat.flatMap((g) => (isV3Composed(g) ? g.handlerTags : [g.handlerTag]));
  if (new Set(handlerTags).size !== handlerTags.length) throw new Error('[react-native-gesture-handler] Each gesture can be used only once in the gesture composition.');
  return { handlerTags, type, gestures: flat, config: {} };
}

/** Members may be active at the same time. */
export const useSimultaneousGestures = (...gestures: AnyGesture[]) => useComposed('SimultaneousGesture', gestures);
/** Each member activates only if all earlier ones failed. */
export const useExclusiveGestures = (...gestures: AnyGesture[]) => useComposed('ExclusiveGesture', gestures);
/** Members race; the first to activate cancels the others. */
export const useCompetingGestures = (...gestures: AnyGesture[]) => useComposed('CompetingGesture', gestures);

/** v3's imperative state control (for `manualActivation` gestures and touch callbacks). */
export const GestureStateManager = {
  begin: (handlerTag: number) => setHandlerState(handlerTag, State.BEGAN),
  activate: (handlerTag: number) => setHandlerState(handlerTag, State.ACTIVE),
  fail: (handlerTag: number) => setHandlerState(handlerTag, State.FAILED),
  deactivate: (handlerTag: number) => setHandlerState(handlerTag, State.END),
};
