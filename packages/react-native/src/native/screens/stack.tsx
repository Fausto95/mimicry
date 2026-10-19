import React, { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HostType } from '@mimicry/react-native-fabric';
import { AnimatedValue } from '../../animated/animated';
import { Platform, useWindowDimensions } from '../../apis/core';
import { PanResponder } from '../../apis/pan-responder';
import { stackTransition, type StackAnimationName, type TransitionKind } from './transitions';

/**
 * The native side of react-native-screens' stack: RNSScreenStack and
 * RNSScreen / RNSModalScreen.
 *
 * Like UINavigationController / the Android fragment stack, the stack owns
 * its screens' presentation: React decides which screens exist (children in
 * order), the stack decides how they move. A screen React removes is kept
 * rendered — its last element — until its pop transition finishes, which is
 * how a native view controller outlives its React node during a pop.
 *
 * Screens tell the stack about themselves (presentation, animation, events)
 * through StackItemContext; the stack tells each screen where to be through
 * Animated values on the same context.
 */

export type Presentation =
  | 'push' | 'modal' | 'transparentModal' | 'containedModal' | 'containedTransparentModal'
  | 'fullScreenModal' | 'formSheet' | 'pageSheet';

/** Props a screen registers with its stack (a subset of RNSScreen's native props). */
export interface ScreenRegistration {
  stackPresentation?: Presentation;
  stackAnimation?: StackAnimationName;
  replaceAnimation?: 'push' | 'pop';
  transitionDuration?: number;
  gestureEnabled?: boolean;
  fullScreenSwipeEnabled?: boolean;
  title?: string;
  backTitle?: string;
  callbacks: Record<string, ((event: { nativeEvent: Record<string, unknown> }) => void) | undefined>;
}

export interface StackItem {
  key: string;
  /** current position in the displayed stack (exiting screens included) */
  index: number;
  /** what the screen registered on its last render */
  screen: ScreenRegistration;
  /** 0 = in place, 1 = fully transitioned away (meaning depends on the transition) */
  progress: AnimatedValue;
  /** the style the screen applies to itself for the running transition */
  style: unknown;
  /** whether the screen can currently be seen (covered screens are not painted) */
  visible: boolean;
  /** true while React has removed it and its pop transition runs */
  exiting: boolean;
  emit(name: string, nativeEvent?: Record<string, unknown>): void;
}

export interface StackApi {
  /** the item below `key`, for back titles */
  previous(key: string): StackItem | null;
  /** the user dismissed `key` natively (back button, swipe, hardware back) */
  dismiss(key: string, origin: 'button' | 'gesture' | 'hardware'): void;
  /** register the screen's props (called by RNSScreen on every commit) */
  register(key: string, screen: ScreenRegistration): void;
  /** interactive swipe-back is allowed for the top screen */
  canSwipeBack(key: string): boolean;
}

export const StackContext = createContext<StackApi | null>(null);
export const StackItemContext = createContext<StackItem | null>(null);

type Displayed = { key: string; element: React.ReactElement };

const isModal = (p: Presentation | undefined) => !!p && p !== 'push' && p !== 'containedModal';
const isTransparent = (p: Presentation | undefined) => p === 'transparentModal' || p === 'containedTransparentModal';

function emitTo(screen: ScreenRegistration, name: string, nativeEvent: Record<string, unknown> = {}): void {
  screen.callbacks[name]?.({ nativeEvent });
}

export const ScreenStack = forwardRef<any, any>(function ScreenStack(props, ref) {
  const { children, style, onFinishTransitioning, nativeContainerBackgroundColor, ...rest } = props;
  const { width, height } = useWindowDimensions();
  const [, rerender] = useState(0);
  const items = useRef(new Map<string, StackItem>()).current;
  const elements = useRef(new Map<string, React.ReactElement>()).current;
  /** keys React currently renders, in order */
  const live = useRef<string[]>([]);
  /** keys kept rendered while their pop transition runs */
  const exiting = useRef(new Map<string, number>()).current;
  /** keys the user dismissed natively and whose pop already started */
  const dismissed = useRef(new Set<string>()).current;
  const running = useRef<{ stop(): void } | null>(null);
  const size = useRef({ width, height });
  size.current = { width, height };

  // ── reconcile children with what is displayed ─────────────────────────
  const incoming: Displayed[] = [];
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement(child)) continue;
    const key = String(child.key);
    elements.set(key, child);
    incoming.push({ key, element: child });
  }
  const displayed: Displayed[] = incoming.slice();
  for (const [key, at] of Array.from(exiting).sort((a, b) => a[1] - b[1])) {
    if (incoming.some((d) => d.key === key)) {
      exiting.delete(key); // came back (e.g. a cancelled removal)
      continue;
    }
    const element = elements.get(key);
    if (element) displayed.splice(Math.min(at, displayed.length), 0, { key, element });
  }

  const item = (key: string): StackItem => {
    let it = items.get(key);
    if (!it) {
      const progress = new AnimatedValue(0);
      it = {
        key, index: 0, progress, style: null, visible: true, exiting: false,
        screen: { callbacks: {} },
        emit(name, nativeEvent) {
          emitTo(this.screen, name, nativeEvent);
        },
      };
      items.set(key, it);
    }
    return it;
  };
  displayed.forEach((d, index) => {
    const it = item(d.key);
    it.index = index;
    it.exiting = exiting.has(d.key);
  });

  // ── transitions ──────────────────────────────────────────────────────
  const finish = useCallback(() => {
    running.current = null;
    rerender((n) => n + 1);
    onFinishTransitioning?.({ nativeEvent: {} });
  }, [onFinishTransitioning]);

  const run = useCallback((kind: TransitionKind, moving: StackItem, below: StackItem | null, interactiveFrom?: number, velocity = 0, done?: () => void) => {
    running.current?.stop();
    const presentation = moving.screen.stackPresentation;
    const transition = stackTransition({
      platform: Platform.OS as 'ios' | 'android',
      kind,
      presentation: presentation ?? 'push',
      animation: moving.screen.stackAnimation ?? 'default',
      duration: moving.screen.transitionDuration,
      size: size.current,
    });
    moving.style = transition.moving(moving.progress);
    if (below) below.style = transition.below(moving.progress);
    const to = kind === 'push' ? 0 : 1;
    if (interactiveFrom === undefined) moving.progress.setValue(kind === 'push' ? 1 : 0);
    rerender((n) => n + 1);
    const animation = transition.animate(moving.progress, to, velocity);
    running.current = animation;
    animation.start(({ finished }) => {
      if (!finished) return;
      done?.();
      finish();
    });
  }, [finish]);

  // Detect pushes and pops after React commits the new children.
  useLayoutEffect(() => {
    const before = live.current;
    const after = incoming.map((d) => d.key);
    live.current = after;
    if (before.length === 0) {
      // First mount: the root screen appears without animation.
      const top = after.length ? items.get(after[after.length - 1]!) : null;
      if (top) {
        top.emit('onWillAppear');
        top.emit('onAppear');
      }
      return;
    }
    const oldTop = before[before.length - 1];
    const newTop = after[after.length - 1];
    const removed = before.filter((k) => !after.includes(k));
    if (oldTop === newTop) {
      // screens below the top changed (e.g. a replace below): no transition
      for (const key of removed) if (!dismissed.has(key)) items.delete(key);
      return;
    }
    const added = newTop !== undefined && !before.includes(newTop);
    if (added) {
      const incomingItem = items.get(newTop!)!;
      const outgoing = oldTop !== undefined ? items.get(oldTop) ?? null : null;
      const replacing = oldTop !== undefined && removed.includes(oldTop);
      if (replacing && incomingItem.screen.replaceAnimation === 'pop') {
        // `replace` with a pop: the old top slides out over the new one
        exiting.set(oldTop!, after.length);
        rerender((n) => n + 1);
        if (outgoing) {
          outgoing.emit('onWillDisappear');
          incomingItem.emit('onWillAppear');
          run('pop', outgoing, incomingItem, undefined, 0, () => {
            exiting.delete(oldTop!);
            outgoing.emit('onDisappear');
            items.delete(oldTop!);
            incomingItem.emit('onAppear');
          });
        }
        return;
      }
      if (replacing) {
        exiting.set(oldTop!, before.indexOf(oldTop!));
      }
      incomingItem.emit('onWillAppear');
      outgoing?.emit('onWillDisappear');
      run('push', incomingItem, outgoing, undefined, 0, () => {
        incomingItem.emit('onAppear');
        outgoing?.emit('onDisappear');
        if (replacing) {
          exiting.delete(oldTop!);
          items.delete(oldTop!);
        }
      });
      return;
    }
    // The top went away: pop to the new top.
    const revealed = newTop !== undefined ? items.get(newTop) ?? null : null;
    for (const key of removed) {
      const it = items.get(key);
      if (!it) continue;
      if (key !== oldTop) {
        // popped together with the top (popToTop): gone without animating
        it.emit('onDisappear');
        items.delete(key);
        continue;
      }
      if (dismissed.has(key)) {
        // the user already popped it natively; its transition is done or running
        if (!running.current) {
          dismissed.delete(key);
          items.delete(key);
        }
        continue;
      }
      exiting.set(key, before.indexOf(key));
      rerender((n) => n + 1);
      it.emit('onWillDisappear');
      revealed?.emit('onWillAppear');
      run('pop', it, revealed, undefined, 0, () => {
        exiting.delete(key);
        it.emit('onDisappear');
        items.delete(key);
        revealed?.emit('onAppear');
      });
    }
  });

  // ── native dismissal (back button, swipe, hardware back) ─────────────
  const api = useMemo<StackApi>(() => ({
    previous(key) {
      const order = [...live.current];
      const i = order.indexOf(key);
      return i > 0 ? items.get(order[i - 1]!) ?? null : null;
    },
    register(key, screen) {
      const it = items.get(key);
      if (it) it.screen = screen;
    },
    canSwipeBack(key) {
      const order = live.current;
      const it = items.get(key);
      return order[order.length - 1] === key && order.length > 1 && !!it && it.screen.gestureEnabled !== false && !isModal(it.screen.stackPresentation);
    },
    dismiss(key, origin) {
      const order = live.current;
      if (order[order.length - 1] !== key || order.length < 2 || dismissed.has(key)) return;
      const it = items.get(key);
      const revealed = items.get(order[order.length - 2]!) ?? null;
      if (!it) return;
      if (Platform.OS === 'android' && origin === 'button') {
        // Android's toolbar reports the click; navigation pops from JS.
        it.emit('onHeaderBackButtonClicked');
        return;
      }
      dismissed.add(key);
      it.emit('onWillDisappear');
      revealed?.emit('onWillAppear');
      run('pop', it, revealed, undefined, 0, () => {
        it.emit('onDisappear');
        revealed?.emit('onAppear');
        // iOS reports the dismissal once the pop finished; React then removes the route.
        it.emit('onDismissed', { dismissCount: 1 });
      });
    },
  }), [run]);

  // ── iOS edge swipe back ──────────────────────────────────────────────
  const swipe = useRef<{ key: string; startX: number } | null>(null);
  const responder = useMemo(() => {
    if (Platform.OS !== 'ios') return null;
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (e, g) => {
        const order = live.current;
        const key = order[order.length - 1];
        if (!key || running.current || !api.canSwipeBack(key)) return false;
        const it = items.get(key)!;
        const startX = (e.nativeEvent as any).pageX - g.dx;
        const fromEdge = it.screen.fullScreenSwipeEnabled || startX < 24;
        if (!fromEdge || g.dx < 8 || Math.abs(g.dx) < Math.abs(g.dy) * 1.5) return false;
        swipe.current = { key, startX };
        return true;
      },
      onPanResponderGrant: () => {
        const key = swipe.current!.key;
        const it = items.get(key)!;
        const below = api.previous(key);
        const transition = stackTransition({ platform: 'ios', kind: 'pop', presentation: 'push', animation: it.screen.stackAnimation ?? 'default', size: size.current });
        it.style = transition.moving(it.progress);
        if (below) below.style = transition.below(it.progress);
        it.emit('onWillDisappear');
        below?.emit('onWillAppear');
        rerender((n) => n + 1);
      },
      onPanResponderMove: (_e, g) => {
        const s = swipe.current;
        if (!s) return;
        items.get(s.key)?.progress.setValue(Math.max(0, Math.min(1, g.dx / size.current.width)));
      },
      onPanResponderRelease: (_e, g) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const it = items.get(s.key);
        if (!it) return;
        const below = api.previous(s.key);
        const progress = Math.max(0, Math.min(1, g.dx / size.current.width));
        const velocity = g.vx; // points per ms
        const complete = progress > 0.5 || velocity > 0.3;
        if (complete) {
          dismissed.add(s.key);
          run('pop', it, below, progress, velocity / Math.max(1, size.current.width) * 1000, () => {
            it.emit('onDisappear');
            below?.emit('onAppear');
            it.emit('onDismissed', { dismissCount: 1 });
          });
        } else {
          run('push', it, below, progress, 0, () => {
            it.emit('onGestureCancel');
            it.emit('onAppear');
            below?.emit('onDisappear');
          });
        }
      },
      onPanResponderTerminate: () => {
        swipe.current = null;
      },
    });
  }, [api, run]);

  // ── visibility: only what can be seen is painted ─────────────────────
  const transitioning = !!running.current || !!swipe.current;
  let coveredFrom = -1;
  for (let i = displayed.length - 1; i >= 0; i--) {
    const it = items.get(displayed[i]!.key)!;
    const opaque = !isTransparent(it.screen.stackPresentation) && !it.exiting;
    if (opaque && !(transitioning && i === displayed.length - 1)) {
      coveredFrom = i;
      break;
    }
  }
  displayed.forEach((d, i) => {
    const it = items.get(d.key)!;
    // the screen right below a running transition stays visible
    const belowTransition = transitioning && i >= coveredFrom - 1;
    it.visible = i >= coveredFrom || belowTransition || coveredFrom === -1;
    if (!transitioning && !it.exiting && i === displayed.length - 1) it.style = null;
    if (!transitioning && i < displayed.length - 1) it.style = null;
  });

  return React.createElement(
    StackContext.Provider,
    { value: api },
    React.createElement(
      HostType.View,
      {
        ...rest,
        ref,
        ...(responder?.panHandlers ?? {}),
        style: [{ flex: 1, overflow: 'hidden', backgroundColor: nativeContainerBackgroundColor }, style],
      },
      displayed.map((d) => React.createElement(StackItemContext.Provider, { key: d.key, value: items.get(d.key)! }, d.element)),
    ),
  );
});

