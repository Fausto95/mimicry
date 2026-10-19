import { maybeEngine } from '../engine-ref';
import { useEffect, useLayoutEffect, useMemo, useRef, type DependencyList } from 'react';
import type { HostNode } from '@mimicry/engine';
import { Mutable, makeMutable, type SharedValue } from './mutable';
import { Mapper, uiRuntime, untracked, type Driver } from './runtime';
import { AnimatedUpdater } from './updater';

/**
 * Reanimated's hooks. Without the worklets Babel plugin there is no closure
 * capture list, so updaters without `deps` re-run after every render; an
 * animation that is already heading to the same target keeps running.
 */

export function useSharedValue<T>(initial: T): SharedValue<T> {
  const ref = useRef<Mutable<T> | null>(null);
  ref.current ??= makeMutable(initial);
  const value = ref.current;
  useEffect(() => () => value.cancel(), [value]);
  return value;
}

/** Runs `effect` after renders where `deps` changed (every render when undefined), skipping the first. */
function useRerun(run: () => void, deps: DependencyList | undefined): void {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    run();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function useUpdater(kind: 'style' | 'props', updater: () => unknown, deps?: DependencyList): AnimatedUpdater {
  const handle = useMemo(() => new AnimatedUpdater(kind, updater), []); // eslint-disable-line react-hooks/exhaustive-deps
  handle.updater = updater;
  useRerun(() => handle.mapper.run(), deps);
  useEffect(() => {
    handle.activate();
    return () => handle.deactivate();
  }, [handle]);
  return handle;
}

export function useAnimatedStyle<T>(updater: () => T, deps?: DependencyList): T {
  return useUpdater('style', updater, deps) as unknown as T;
}

export function useAnimatedProps<T>(updater: () => T, deps?: DependencyList, _adapters?: unknown): Partial<T> {
  return useUpdater('props', updater, deps) as unknown as Partial<T>;
}

/** A read-only shared value computed from other shared values. */
export function useDerivedValue<T>(updater: () => T, deps?: DependencyList): SharedValue<T> {
  const latest = useRef(updater);
  latest.current = updater;
  const state = useMemo(() => {
    const value = new Mutable<T>(undefined as T);
    const mapper = new Mapper(() => value.write(latest.current()));
    mapper.run();
    return { value, mapper };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useRerun(() => state.mapper.run(), deps);
  useEffect(() => {
    if (!state.mapper.active) {
      state.mapper.active = true;
      state.mapper.run();
    }
    return () => state.mapper.stop();
  }, [state]);
  return state.value;
}

/** Calls `react(current, previous)` whenever the values `prepare` reads change. */
export function useAnimatedReaction<T>(prepare: () => T, react: (current: T, previous: T | null) => void, deps?: DependencyList): void {
  const latest = useRef({ prepare, react });
  latest.current = { prepare, react };
  const mapper = useMemo(() => {
    let previous: T | null = null;
    return new Mapper(() => {
      const current = latest.current.prepare();
      untracked(() => latest.current.react(current, previous));
      previous = current;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useRerun(() => mapper.run(), deps);
  useEffect(() => {
    mapper.active = true;
    mapper.run();
    return () => mapper.stop();
  }, [mapper]);
}

// ── frame callbacks ────────────────────────────────────────────────────────

export interface FrameInfo {
  timestamp: number;
  timeSincePreviousFrame: number | null;
  timeSinceFirstFrame: number;
}

let nextCallbackId = 1;

export function useFrameCallback(callback: (info: FrameInfo) => void, autostart = true) {
  const latest = useRef(callback);
  latest.current = callback;
  const handle = useMemo(() => {
    let first: number | null = null;
    let previous: number | null = null;
    let active = false;
    const driver: Driver = {
      step(now) {
        if (!active) return false;
        if (first === null) first = now;
        latest.current({ timestamp: now, timeSincePreviousFrame: previous === null ? null : now - previous, timeSinceFirstFrame: now - first });
        previous = now;
        return active;
      },
    };
    return {
      callbackId: nextCallbackId++,
      get isActive() {
        return active;
      },
      setActive(value: boolean) {
        if (value === active) return;
        active = value;
        if (active) {
          first = null;
          previous = null;
          uiRuntime().addDriver(driver);
        } else uiRuntime().removeDriver(driver);
      },
    };
  }, []);
  useEffect(() => {
    if (autostart) handle.setActive(true);
    return () => handle.setActive(false);
  }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps
  return handle;
}

/** Milliseconds since the hook started, updated every frame. */
export function useTimestamp(isActive = true): SharedValue<number> {
  const timestamp = useSharedValue(0);
  const frame = useFrameCallback(({ timeSinceFirstFrame }) => timestamp.set(timeSinceFirstFrame), isActive);
  useEffect(() => frame.setActive(isActive), [isActive, frame]);
  return timestamp;
}

// ── refs and events ────────────────────────────────────────────────────────

export interface AnimatedRef<T = unknown> {
  (component?: T | null): number | null;
  current: T | null;
  readonly __isAnimatedRef: true;
  /** @internal scroll listeners added by useScrollOffset */
  readonly __scrollListeners: Set<(event: any, node: HostNode) => void>;
  getTag(): number | null;
}

/** A ref usable from "worklets": `measure(ref)`, `scrollTo(ref, …)`, `ref()` → view tag. */
export function useAnimatedRef<T = unknown>(): AnimatedRef<T> {
  const ref = useRef<AnimatedRef<T> | null>(null);
  if (!ref.current) {
    const animatedRef = ((component?: T | null) => {
      if (component !== undefined) {
        animatedRef.current = component;
        return null;
      }
      return animatedRef.getTag();
    }) as AnimatedRef<T>;
    Object.assign(animatedRef, {
      current: null,
      __isAnimatedRef: true,
      __scrollListeners: new Set(),
      getTag: () => hostOf(animatedRef.current)?.id ?? null,
    });
    ref.current = animatedRef;
  }
  return ref.current;
}

export function isAnimatedRef(value: unknown): value is AnimatedRef {
  return typeof value === 'function' && (value as AnimatedRef).__isAnimatedRef === true;
}

/** The host node behind a component instance (View, ScrollView, FlatList…). */
export function hostOf(instance: unknown): HostNode | null {
  if (!instance || typeof instance !== 'object') return null;
  const i = instance as Record<string, any>;
  if (typeof i.setOverrides === 'function') return instance as HostNode;
  for (const getter of ['getNativeScrollRef', 'getScrollableNode', 'getHostNode']) {
    if (typeof i[getter] === 'function') {
      const node = i[getter]();
      if (node && typeof node.setOverrides === 'function') return node as HostNode;
    }
  }
  return null;
}

/** The shared value tracks the scroll offset of the view the animated ref is attached to. */
export function useScrollOffset(animatedRef?: AnimatedRef | null, initial?: SharedValue<number>): SharedValue<number> {
  const own = useSharedValue(0);
  const offset = initial ?? own;
  useEffect(() => {
    if (!animatedRef) return;
    const listener = (event: { contentOffset?: { x: number; y: number } }, node: HostNode) => {
      const o = event.contentOffset ?? { x: 0, y: 0 };
      offset.set(node.props.horizontal ? o.x : o.y);
    };
    animatedRef.__scrollListeners.add(listener);
    return () => {
      animatedRef.__scrollListeners.delete(listener);
    };
  }, [animatedRef, offset]);
  return offset;
}

/** An event handler object Animated components unpack into real props. */
export interface EventHandlerProcessed {
  readonly __reanimatedEventHandler: true;
  readonly eventNames: string[];
  handle(eventName: string, event: unknown): void;
  /** WorkletEventHandler API: listen to a native view's events by tag (libraries attach to their own views) */
  registerForEvents(viewTag: number, fallbackEventName?: string): void;
  unregisterFromEvents(viewTag: number): void;
}

export function isEventHandler(value: unknown): value is EventHandlerProcessed {
  return !!value && typeof value === 'object' && (value as EventHandlerProcessed).__reanimatedEventHandler === true;
}

/** `topScroll` / `onScroll` / `scroll` → `onScroll` */
function propName(eventName: string): string {
  if (eventName.startsWith('on')) return eventName;
  const bare = eventName.startsWith('top') ? eventName.slice(3) : eventName;
  return `on${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
}

/**
 * An event handler object: Animated components route their events to
 * `handle`; libraries can also attach it to one of their native views by
 * tag (WorkletEventHandler.registerForEvents).
 */
function eventHandler(eventNames: string[], handle: (eventName: string, event: unknown) => void): EventHandlerProcessed {
  const detach = new Map<number, () => void>();
  return {
    __reanimatedEventHandler: true as const,
    eventNames,
    handle,
    registerForEvents(viewTag: number, fallbackEventName?: string) {
      const engine = maybeEngine();
      if (!engine || detach.has(viewTag)) return;
      const listen = eventNames.length ? eventNames : fallbackEventName ? [propName(fallbackEventName)] : [];
      detach.set(viewTag, engine.events.attach(viewTag, listen, (event) => handle(String(event.eventName ?? listen[0]), event)));
    },
    unregisterFromEvents(viewTag: number) {
      detach.get(viewTag)?.();
      detach.delete(viewTag);
    },
  };
}

export function useEvent<E>(handler: (event: E) => void, eventNames: string[] = [], _rebuild = false): EventHandlerProcessed {
  const latest = useRef(handler);
  latest.current = handler;
  return useMemo(
    () => eventHandler(eventNames.map(propName), (_name, event) => latest.current(event as E)),
    [eventNames.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

export function useHandler<Context extends Record<string, unknown>>(_handlers: unknown, _deps?: DependencyList) {
  const context = useRef<Context>({} as Context).current;
  return { context, doDependenciesDiffer: true, useWeb: false };
}

type ScrollHandlers = {
  onScroll?: (event: any, context: Record<string, unknown>) => void;
  onBeginDrag?: (event: any, context: Record<string, unknown>) => void;
  onEndDrag?: (event: any, context: Record<string, unknown>) => void;
  onMomentumBegin?: (event: any, context: Record<string, unknown>) => void;
  onMomentumEnd?: (event: any, context: Record<string, unknown>) => void;
};

const SCROLL_EVENTS: Record<keyof ScrollHandlers, string> = {
  onScroll: 'onScroll',
  onBeginDrag: 'onScrollBeginDrag',
  onEndDrag: 'onScrollEndDrag',
  onMomentumBegin: 'onMomentumScrollBegin',
  onMomentumEnd: 'onMomentumScrollEnd',
};

export function useAnimatedScrollHandler(handlers: ScrollHandlers | ScrollHandlers['onScroll'], _deps?: DependencyList): EventHandlerProcessed {
  const latest = useRef(handlers);
  latest.current = handlers;
  const context = useRef<Record<string, unknown>>({}).current;
  return useMemo(() => {
    const byProp = new Map<string, keyof ScrollHandlers>();
    const initial = typeof handlers === 'function' ? { onScroll: handlers } : handlers ?? {};
    for (const key of Object.keys(initial) as Array<keyof ScrollHandlers>) if (SCROLL_EVENTS[key]) byProp.set(SCROLL_EVENTS[key], key);
    return eventHandler(Array.from(byProp.keys()), (eventName, event) => {
      const current = latest.current;
      const set = typeof current === 'function' ? { onScroll: current } : current ?? {};
      set[byProp.get(eventName)!]?.(event, context);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useComposedEventHandler(handlers: Array<EventHandlerProcessed | null>): EventHandlerProcessed {
  const list = handlers.filter(Boolean) as EventHandlerProcessed[];
  return useMemo(
    () =>
      eventHandler(Array.from(new Set(list.flatMap((h) => h.eventNames))), (eventName, event) => {
        for (const h of list) if (h.eventNames.includes(eventName)) h.handle(eventName, event);
      }),
    list, // eslint-disable-line react-hooks/exhaustive-deps
  );
}

// ── device state ───────────────────────────────────────────────────────────

export function useReducedMotion(): boolean {
  return false;
}

export const KeyboardState = { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 } as const;

/** The software keyboard is the host's (a real <input>); its height is not simulated. */
export function useAnimatedKeyboard(_options?: unknown) {
  const height = useSharedValue(0);
  const state = useSharedValue<number>(KeyboardState.CLOSED);
  return useMemo(() => ({ height, state }), [height, state]);
}

export const SensorType = { ACCELEROMETER: 1, GYROSCOPE: 2, GRAVITY: 3, MAGNETIC_FIELD: 4, ROTATION: 5 } as const;
export const IOSReferenceFrame = { XArbitraryZVertical: 0, XArbitraryCorrectedZVertical: 1, XMagneticNorthZVertical: 2, XTrueNorthZVertical: 3, Auto: 4 } as const;
export const InterfaceOrientation = { ROTATION_0: 0, ROTATION_90: 90, ROTATION_180: 180, ROTATION_270: 270 } as const;

/** Sensors read as at rest: a simulator has no motion hardware. */
export function useAnimatedSensor(sensorType: number, config?: Record<string, unknown>) {
  const sensor = useSharedValue<Record<string, number>>(
    sensorType === SensorType.ROTATION ? { qw: 1, qx: 0, qy: 0, qz: 0, yaw: 0, pitch: 0, roll: 0, interfaceOrientation: 0 } : { x: 0, y: 0, z: 0, interfaceOrientation: 0 },
  );
  return useMemo(() => ({ sensor, unregister() {}, isAvailable: false, config: { interval: 'auto', adjustToInterfaceOrientation: true, iosReferenceFrame: 4, ...config } }), [sensor]); // eslint-disable-line react-hooks/exhaustive-deps
}
