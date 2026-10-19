import React, { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { flattenStyle, type HostNode } from '@mimicry/react-native-fabric';
import { Image, Text, View } from '../components/primitives';
import { FlatList, ScrollView } from '../components/lists';
import { CSSController, CSS_PROPS, hasCSS } from './css';
import { hostOf, isAnimatedRef, isEventHandler, type AnimatedRef, type EventHandlerProcessed } from './hooks';
import { layoutTransitionFor, playLayoutAnimation } from './layout-animations';
import { Mutable } from './mutable';
import type { TimelineRun } from './timeline';
import { AnimatedUpdater, isUpdater, type UpdaterTarget } from './updater';

/**
 * Animated components. Rendering resolves animated styles/props to their
 * current snapshot; after mount, updater changes are written straight onto
 * the host node (style overrides, setNativeProps) without a React render —
 * Reanimated's "UI thread" updates. Components without a host node behind
 * their ref fall back to re-rendering.
 *
 * Also wires `entering` / `exiting` / `layout` layout animations, Reanimated
 * 4 CSS animations and transitions, worklet event handlers
 * (useAnimatedScrollHandler / useEvent) and scroll offsets for animated refs.
 */

// ── LayoutAnimationConfig ──────────────────────────────────────────────────

interface LayoutConfig {
  skipEntering: () => boolean;
  skipExiting: () => boolean;
}

const LayoutConfigContext = createContext<LayoutConfig | null>(null);

/** Skips entering animations of children mounted with it, and/or exiting ones when it unmounts. */
export function LayoutAnimationConfig({ skipEntering, skipExiting, children }: { skipEntering?: boolean; skipExiting?: boolean; children?: React.ReactNode }) {
  const initial = useRef(true);
  const unmounting = useRef(false);
  useEffect(() => {
    initial.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);
  const parent = useContext(LayoutConfigContext);
  const value = useMemo<LayoutConfig>(
    () => ({
      skipEntering: () => (!!skipEntering && initial.current) || !!parent?.skipEntering(),
      skipExiting: () => (!!skipExiting && unmounting.current) || !!parent?.skipExiting(),
    }),
    [skipEntering, skipExiting, parent],
  );
  return React.createElement(LayoutConfigContext.Provider, { value }, children);
}

// ── binding updaters to a host node ────────────────────────────────────────

/** Pushes updater snapshots onto the host node, or asks React to re-render. */
class Binding implements UpdaterTarget {
  node: HostNode | null = null;
  instance: unknown = null;
  rendering = false;
  styles: AnimatedUpdater[] = [];
  props: AnimatedUpdater[] = [];
  private appliedStyleKeys = new Set<string>();
  private readonly subscriptions = new Map<AnimatedUpdater, () => void>();

  constructor(private readonly rerender: () => void) {}

  /** Subscribe to the current updaters (and drop old ones). */
  sync(): void {
    this.rendering = false;
    const wanted = new Set([...this.styles, ...this.props]);
    for (const [updater, unsubscribe] of this.subscriptions) {
      if (!wanted.has(updater)) {
        unsubscribe();
        this.subscriptions.delete(updater);
      }
    }
    for (const updater of wanted) if (!this.subscriptions.has(updater)) this.subscriptions.set(updater, updater.subscribe(this));
    // The render that led here already used the latest snapshots; only hosts need writing.
    this.apply(false);
  }

  /** an updater published a new snapshot */
  update(): void {
    this.apply(true);
  }

  private apply(changed: boolean): void {
    // Updaters re-run during this component's render; that render shows them already.
    if (this.rendering) return;
    const node = this.node;
    if (!node) {
      if (changed) this.rerender();
      return;
    }
    const style: Record<string, unknown> = {};
    for (const updater of this.styles) Object.assign(style, flattenStyle(updater.snapshot));
    const clear: Record<string, unknown> = {};
    for (const key of this.appliedStyleKeys) if (!(key in style)) clear[key] = undefined;
    this.appliedStyleKeys = new Set(Object.keys(style));
    node.setOverrides({ ...clear, ...style });
    if (this.props.length) {
      const props: Record<string, unknown> = {};
      for (const updater of this.props) Object.assign(props, updater.snapshot);
      const target = this.instance as { setNativeProps?: (p: Record<string, unknown>) => void } | null;
      if (target && typeof target.setNativeProps === 'function') target.setNativeProps(props);
      else if (changed) this.rerender();
    }
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Props Reanimated consumes itself (shared element transitions are not drawn). */
const REANIMATED_ONLY_PROPS = new Set(['sharedTransitionTag', 'sharedTransitionStyle', 'sharedTransitionBoundary', 'itemLayoutAnimation', 'skipEnteringExitingAnimations']);

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && !('$$typeof' in v);

function containsShared(value: unknown): boolean {
  if (value instanceof Mutable) return true;
  if (Array.isArray(value)) return value.some(containsShared);
  if (isPlain(value)) return Object.values(value).some(containsShared);
  return false;
}

/** Style arrays may nest updaters among plain styles; keep their order. */
function splitStyle(style: unknown, updaters: AnimatedUpdater[], plain: unknown[]): void {
  if (Array.isArray(style)) {
    for (const s of style) splitStyle(s, updaters, plain);
  } else if (isUpdater(style)) updaters.push(style);
  else if (style) plain.push(style);
}

function assignRef(ref: React.Ref<unknown> | undefined, value: unknown): void {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<unknown>).current = value;
}

function signatureOf(builder: unknown): string {
  if (!builder) return '';
  const ctor = typeof builder === 'function' ? builder : (builder as object).constructor;
  return `${(ctor as { name?: string }).name}:${typeof builder === 'object' ? JSON.stringify(builder) : ''}`;
}

// ── createAnimatedComponent ────────────────────────────────────────────────

export function createAnimatedComponent<P extends object>(Component: React.ComponentType<P>, _options?: unknown): React.ComponentType<any> {
  const Animated = forwardRef<unknown, any>(function AnimatedComponent(props, forwardedRef) {
    const { entering, exiting, layout, animatedProps, style, ...rest } = props;
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    const binding = useMemo(() => new Binding(rerender), []);
    binding.rendering = true;
    const config = useContext(LayoutConfigContext);

    // Styles: updaters (useAnimatedStyle), plain styles, inline shared values, CSS props.
    const updaters: AnimatedUpdater[] = [];
    const plain: unknown[] = [];
    splitStyle(style, updaters, plain);
    const flat = flattenStyle(plain);
    const css = hasCSS(flat);
    const staticStyle = css ? Object.fromEntries(Object.entries(flat).filter(([k]) => !CSS_PROPS.has(k))) : flat;
    // Shared values used directly in a plain style (`{ opacity: sv }`) make it an updater too,
    // ordered before useAnimatedStyle results like the plain style it replaces.
    const inlineRef = useRef<{ style: Record<string, unknown>; updater: AnimatedUpdater } | null>(null);
    const inline = containsShared(staticStyle);
    if (inline) {
      if (!inlineRef.current) {
        const holder = { style: staticStyle, updater: null as unknown as AnimatedUpdater };
        holder.updater = new AnimatedUpdater('style', () => holder.style);
        inlineRef.current = holder;
      } else {
        inlineRef.current.style = staticStyle;
        inlineRef.current.updater.mapper.run();
      }
      updaters.unshift(inlineRef.current.updater);
    } else if (inlineRef.current) {
      inlineRef.current.updater.deactivate();
      inlineRef.current = null;
    }
    useEffect(() => () => inlineRef.current?.updater.deactivate(), []);
    const propUpdaters = (Array.isArray(animatedProps) ? animatedProps : animatedProps ? [animatedProps] : []).filter(isUpdater);
    binding.styles = updaters;
    binding.props = propUpdaters;

    // Worklet event handlers → plain props; animated refs see scroll events.
    const resolved: Record<string, unknown> = {};
    const handlers: EventHandlerProcessed[] = [];
    for (const [key, value] of Object.entries(rest)) {
      if (REANIMATED_ONLY_PROPS.has(key)) continue;
      if (isEventHandler(value)) handlers.push(value);
      else resolved[key] = value;
    }
    for (const handler of handlers) {
      for (const name of handler.eventNames) {
        const previous = resolved[name] as ((e: unknown) => void) | undefined;
        resolved[name] = (event: { nativeEvent?: unknown }) => {
          handler.handle(name, event?.nativeEvent ?? event);
          previous?.(event);
        };
      }
    }
    if (isAnimatedRef(forwardedRef)) {
      const aref = forwardedRef as AnimatedRef;
      const previous = resolved.onScroll as ((e: unknown) => void) | undefined;
      resolved.onScroll = (event: { nativeEvent?: unknown }) => {
        const node = binding.node;
        if (node) for (const listener of aref.__scrollListeners) listener(event?.nativeEvent ?? event, node);
        previous?.(event);
      };
    }
    for (const updater of propUpdaters) Object.assign(resolved, updater.snapshot);

    const setRef = useCallback(
      (instance: unknown) => {
        binding.instance = instance;
        binding.node = hostOf(instance);
        assignRef(forwardedRef as React.Ref<unknown>, instance);
      },
      [forwardedRef, binding],
    );

    // Updater snapshots → host overrides.
    useLayoutEffect(() => binding.sync());
    useEffect(() => () => binding.dispose(), [binding]);

    // CSS animations and transitions.
    const cssController = useRef<CSSController | null>(null);
    useLayoutEffect(() => {
      if (!css && !cssController.current) return;
      const node = binding.node;
      if (!node) return;
      cssController.current ??= new CSSController();
      cssController.current.sync(node, flat);
    });
    useEffect(() => () => cssController.current?.dispose(), []);

    // entering: once, on mount.
    useLayoutEffect(() => {
      const node = binding.node;
      if (!entering || !node || config?.skipEntering()) return;
      let run: TimelineRun | null = playLayoutAnimation(node, entering, 'entering', () => {
        run = null;
      });
      return () => run?.cancel();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // exiting: the engine calls node.exit when React removes the node.
    useLayoutEffect(() => {
      const node = binding.node;
      if (!node) return;
      node.exit = exiting ? (done) => (config?.skipExiting() ? done() : void playLayoutAnimation(node, exiting, 'exiting', () => done())) : null;
    });

    // layout: animate frame changes between Yoga layouts.
    const layoutKey = signatureOf(layout);
    useLayoutEffect(() => {
      const node = binding.node;
      if (!node) return;
      node.layoutTransition = layoutTransitionFor(layout, node);
      return () => {
        node.layoutTransition = null;
      };
    }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const snapshots = updaters.map((u) => u.snapshot);
    const renderStyle = inline ? snapshots : updaters.length ? [staticStyle, ...snapshots] : css ? staticStyle : style;
    return React.createElement(Component as React.ComponentType<any>, { ...resolved, style: renderStyle, ref: setRef });
  });
  Animated.displayName = `AnimatedComponent(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Animated;
}

export const AnimatedView = createAnimatedComponent(View as React.ComponentType<any>);
export const AnimatedText = createAnimatedComponent(Text as React.ComponentType<any>);
export const AnimatedImage = createAnimatedComponent(Image as React.ComponentType<any>);
export const AnimatedScrollView = createAnimatedComponent(ScrollView as React.ComponentType<any>);
export const AnimatedFlatList = createAnimatedComponent(FlatList as React.ComponentType<any>);
