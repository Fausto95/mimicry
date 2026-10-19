import type { Engine } from '../engine';
import { syntheticEvent } from '../events';
import type { HostNode } from '../tree/node';
import { hitTest } from './hit-test';

/**
 * React Native's touch handling above the OS: RCTSurfaceTouchHandler on iOS
 * (a gesture recognizer on the surface view) and JSTouchDispatcher on
 * Android (the root view's dispatchTouchEvent) both feed this. It runs the
 * Gesture Responder System — capture/bubble negotiation, grant, move,
 * release, termination — and feeds react-native-gesture-handler's arena.
 *
 * Native gestures are the OS's: a UIScrollView pan / ScrollView drag or a
 * UISwitch / SwitchCompat press handle themselves, and when a scroll view
 * takes over, the platform side calls `nativeGestureStarted` and the JS
 * responder is terminated — exactly how React Native cancels JS touches on
 * device. A touch that stopped a moving scroll view never becomes a tap.
 *
 * The first finger drives the responder system; additional fingers only
 * reach gesture handlers (pinch, rotation, multi-finger pans).
 */
interface Touch {
  id: number;
  path: HostNode[];
  target: HostNode;
  startX: number;
  startY: number;
  startTime: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  time: number;
  prevTime: number;
  /** a native scroll took this touch over */
  native: boolean;
  /** a native control (switch) owns this touch */
  control: boolean;
  /** the touch stopped a moving scroll view; it must not become a tap */
  absorbed: boolean;
  /** a gesture handler activated: no new responders for this touch */
  gestureOwned: boolean;
}

export class PointerInput {
  private touch: Touch | null = null;
  /** fingers after the first, which only gesture handlers see */
  private readonly extraPointers = new Set<number>();
  private responder: HostNode | null = null;
  /** the last sample each pointer fed to the gesture arena */
  private readonly arenaFed = new Map<number, string>();

  constructor(private readonly engine: Engine) {}

  /**
   * Feed one pointer sample to react-native-gesture-handler's arena, once.
   * The platform side may feed it early — right before a native scroll
   * decides whether it may start, so the arena has seen the move that
   * crossed the slop — and the touch handler feeds it again in order;
   * the repeat is dropped.
   */
  feedArena(phase: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, time: number, path: HostNode[] = []): void {
    const key = `${phase}:${x}:${y}:${time}`;
    if (this.arenaFed.get(id) === key) return;
    this.arenaFed.set(id, key);
    const sample = { id, x, y, time };
    const gestures = this.engine.gestures;
    switch (phase) {
      case 'down': gestures.pointerDown(sample, path); break;
      case 'move': gestures.pointerMove(sample); break;
      case 'up': gestures.pointerUp(sample); break;
      case 'cancel': gestures.pointerCancel(sample); break;
    }
  }

  get currentResponder(): HostNode | null {
    return this.responder;
  }

  /** The hit path for a window point (React Native's hit testing rules). */
  pathAt(x: number, y: number): HostNode[] | null {
    return hitTest(this.engine, x, y);
  }

  /** Mouse wheel / trackpad over a scroll view (hosts without OS wheel routing). */
  wheel(x: number, y: number, dx: number, dy: number): void {
    const path = hitTest(this.engine, x, y);
    if (!path) return;
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i]!;
      if (node.kind === 'scroll' && this.engine.scrolls.scrollable(node, axis)) {
        this.engine.scrolls.wheel(node, dx, dy);
        return;
      }
    }
  }

  // ── touches (from the platform's touch handler) ──────────────────────

  /**
   * A finger went down. `stoppedScroll` says whether the OS stopped a
   * moving scroll view under it (the scroll views ran first).
   */
  down(id: number, x: number, y: number, time: number, path: HostNode[] | null, stoppedScroll: boolean): void {
    if (this.touch && this.touch.id !== id) {
      this.extraPointers.add(id);
      this.feedArena('down', id, x, y, time, path ?? []);
      return;
    }
    if (this.touch) return;
    const hit = path ?? [];
    const target = hit[hit.length - 1] ?? this.engine.appRoot.root;
    const touch: Touch = {
      id, path: hit, target, startX: x, startY: y, startTime: time, x, y, prevX: x, prevY: y, time, prevTime: time,
      native: false, control: false, absorbed: stoppedScroll, gestureOwned: false,
    };
    this.touch = touch;
    this.feedArena('down', id, x, y, time, hit);
    if (touch.absorbed || touch.gestureOwned) return;

    // A switch's own touch tracking owns the touch (React Native's Switch claims the responder).
    if (target.kind === 'switch' && !target.props.disabled) {
      touch.control = true;
      return;
    }
    if (target.kind === 'input' && target.props.editable !== false) {
      this.engine.focus.focus(target);
    } else {
      this.engine.focus.tapOutside(target);
    }

    // Responder negotiation: capture (root → target), then bubble (target → root).
    const e = () => this.event('touchstart', touch, time);
    let granted: HostNode | null = null;
    for (const node of hit) {
      if (this.ask(node, 'onStartShouldSetResponderCapture', e())) {
        granted = node;
        break;
      }
    }
    if (!granted) {
      for (let i = hit.length - 1; i >= 0; i--) {
        if (this.ask(hit[i]!, 'onStartShouldSetResponder', e())) {
          granted = hit[i]!;
          break;
        }
      }
    }
    this.dispatchTouch('onTouchStart', touch, time);
    if (granted) this.grant(granted, touch, time);
  }

  move(id: number, x: number, y: number, time: number): void {
    if (this.extraPointers.has(id)) {
      this.feedArena('move', id, x, y, time);
      return;
    }
    const touch = this.touch;
    if (!touch || touch.id !== id) return;
    touch.prevX = touch.x;
    touch.prevY = touch.y;
    touch.prevTime = touch.time;
    touch.x = x;
    touch.y = y;
    touch.time = time;
    this.feedArena('move', id, x, y, time);
    if (touch.native || touch.absorbed || touch.control) return;
    if (touch.gestureOwned) {
      this.dispatchTouch('onTouchMove', touch, time);
      if (this.responder) this.call(this.responder, 'onResponderMove', this.event('touchmove', touch, time));
      return;
    }
    this.dispatchTouch('onTouchMove', touch, time);
    // A JS responder may be taken over by an ancestor.
    if (this.responder) {
      const e = () => this.event('touchmove', touch, time);
      const path = touch.path;
      const responderIndex = path.indexOf(this.responder);
      const candidates = responderIndex > 0 ? path.slice(0, responderIndex) : [];
      let next: HostNode | null = null;
      for (const node of candidates) {
        if (this.ask(node, 'onMoveShouldSetResponderCapture', e())) {
          next = node;
          break;
        }
      }
      if (!next) {
        for (let i = candidates.length - 1; i >= 0; i--) {
          if (this.ask(candidates[i]!, 'onMoveShouldSetResponder', e())) {
            next = candidates[i]!;
            break;
          }
        }
      }
      if (next && this.transfer(next, touch, time)) return;
      this.call(this.responder, 'onResponderMove', this.event('touchmove', touch, time));
    } else {
      const e = () => this.event('touchmove', touch, time);
      let granted: HostNode | null = null;
      for (const node of touch.path) {
        if (this.ask(node, 'onMoveShouldSetResponderCapture', e())) {
          granted = node;
          break;
        }
      }
      if (!granted) {
        for (let i = touch.path.length - 1; i >= 0; i--) {
          if (this.ask(touch.path[i]!, 'onMoveShouldSetResponder', e())) {
            granted = touch.path[i]!;
            break;
          }
        }
      }
      if (granted) this.grant(granted, touch, time);
    }
  }

  up(id: number, x: number, y: number, time: number): void {
    if (this.extraPointers.has(id)) {
      this.feedArena('up', id, x, y, time);
      this.extraPointers.delete(id);
      return;
    }
    const touch = this.touch;
    if (!touch || touch.id !== id) return;
    touch.prevX = touch.x;
    touch.prevY = touch.y;
    touch.x = x;
    touch.y = y;
    touch.time = time;
    this.feedArena('up', id, x, y, time);
    this.touch = null;
    if (touch.native || touch.absorbed || touch.control) return;
    if (this.responder) {
      const responder = this.responder;
      this.responder = null;
      this.call(responder, 'onResponderRelease', this.event('touchend', touch, time, true));
    }
    this.dispatchTouch('onTouchEnd', touch, time, true);
  }

  cancel(id: number, x: number, y: number, time: number): void {
    if (this.extraPointers.has(id)) {
      this.feedArena('cancel', id, x, y, time);
      this.extraPointers.delete(id);
      return;
    }
    const touch = this.touch;
    if (!touch || touch.id !== id) return;
    this.feedArena('cancel', id, touch.x, touch.y, time);
    this.touch = null;
    if (this.responder) this.terminate(touch, time);
  }

  /**
   * A native scroll view took the current touch (UIScrollView's pan began /
   * ScrollView intercepted): React Native cancels whatever JS had.
   */
  nativeGestureStarted(): void {
    const touch = this.touch;
    if (!touch || touch.native) return;
    touch.native = true;
    if (this.responder) this.terminate(touch, touch.time);
  }

  /**
   * A gesture handler activated during the current touch: it owns the touch
   * from now on. Like RNGH's root view, it cancels the JS responder (unless
   * the gesture opted out with `cancelsJSResponder: false`) and any control press.
   */
  gestureActivated(cancelJSResponder: boolean): void {
    const touch = this.touch;
    if (!touch) return;
    touch.gestureOwned = true;
    if (cancelJSResponder && this.responder) this.terminate(touch, touch.time);
    if (touch.control) {
      touch.target.hostView?.cancelControlTouch?.();
      touch.control = false;
    }
  }

  get activeTouch(): { id: number; native: boolean; gestureOwned: boolean } | null {
    return this.touch;
  }

  // ── responder plumbing ────────────────────────────────────────────────

  private grant(node: HostNode, touch: Touch, time: number): void {
    this.responder = node;
    this.call(node, 'onResponderGrant', this.event('touchstart', touch, time));
  }

  private transfer(next: HostNode, touch: Touch, time: number): boolean {
    const current = this.responder!;
    const allowed = this.ask(current, 'onResponderTerminationRequest', this.event('touchmove', touch, time), true);
    if (!allowed) {
      this.call(next, 'onResponderReject', this.event('touchmove', touch, time));
      return false;
    }
    this.call(current, 'onResponderTerminate', this.event('touchcancel', touch, time));
    this.grant(next, touch, time);
    return true;
  }

  private terminate(touch: Touch, time: number): void {
    const responder = this.responder;
    this.responder = null;
    if (responder) this.call(responder, 'onResponderTerminate', this.event('touchcancel', touch, time, true));
  }

  /** onTouchStart/Move/End bubble to every ancestor that listens. */
  private dispatchTouch(handler: string, touch: Touch, time: number, ended = false): void {
    for (let i = touch.path.length - 1; i >= 0; i--) {
      const node = touch.path[i]!;
      if (typeof node.props[handler] === 'function') {
        this.call(node, handler, this.event(handler.slice(2).toLowerCase(), touch, time, ended));
      }
    }
  }

  private ask(node: HostNode, handler: string, event: unknown, fallback = false): boolean {
    const fn = node.props[handler];
    if (typeof fn !== 'function') return fallback;
    const result = this.engine.events.invoke<boolean>(node, handler, event, 'discrete');
    return result === undefined ? fallback : !!result;
  }

  private call(node: HostNode, handler: string, event: unknown): void {
    this.engine.events.invoke(node, handler, event, handler === 'onResponderMove' ? 'continuous' : 'discrete');
  }

  private event(type: string, touch: Touch, time: number, ended = false) {
    const [lx, ly] = this.engine.geometry.toLocal(touch.target, touch.x, touch.y);
    const t = {
      identifier: touch.id,
      locationX: lx,
      locationY: ly,
      pageX: touch.x,
      pageY: touch.y,
      target: touch.target.id,
      timestamp: time,
      force: ended ? 0 : 1,
    };
    const e = syntheticEvent(type, touch.target, {
      ...t,
      changedTouches: [t],
      touches: ended ? [] : [t],
    }, time);
    e.touchHistory = {
      numberActiveTouches: ended ? 0 : 1,
      indexOfSingleActiveTouch: touch.id,
      mostRecentTimeStamp: time,
      touchBank: Object.assign([], {
        [touch.id]: {
          touchActive: !ended,
          startPageX: touch.startX,
          startPageY: touch.startY,
          startTimeStamp: touch.startTime,
          currentPageX: touch.x,
          currentPageY: touch.y,
          currentTimeStamp: touch.time,
          previousPageX: touch.prevX,
          previousPageY: touch.prevY,
          previousTimeStamp: touch.prevTime,
        },
      }),
    };
    return e;
  }
}
