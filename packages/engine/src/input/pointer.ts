import type { PointerPhase } from '@mimicry/protocol';
import type { Engine } from '../engine';
import { syntheticEvent } from '../events';
import type { HostNode } from '../tree/node';
import { hitTest } from './hit-test';

/**
 * Touch pipeline: hit test → native gestures (scroll views, switches) →
 * React Native's Gesture Responder System (capture/bubble negotiation, grant,
 * move, release, termination). Scroll views are native: once a drag passes
 * the touch slop they take the gesture and the JS responder is terminated,
 * exactly how a UIScrollView cancels touches on device.
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
  scroll: HostNode | null;
  /** scroll views that could take this gesture, innermost first */
  scrollCandidates: HostNode[];
  control: HostNode | null;
  /** the touch stopped a moving scroll view; it must not become a tap */
  absorbed: boolean;
}

export class PointerInput {
  private touch: Touch | null = null;
  private responder: HostNode | null = null;

  constructor(private readonly engine: Engine) {}

  get currentResponder(): HostNode | null {
    return this.responder;
  }

  handle(phase: PointerPhase, id: number, x: number, y: number, time: number): void {
    switch (phase) {
      case 'down':
        if (this.touch) return; // single-touch for now
        this.down(id, x, y, time);
        break;
      case 'move':
        if (this.touch?.id === id) this.move(x, y, time);
        break;
      case 'up':
        if (this.touch?.id === id) this.up(x, y, time);
        break;
      case 'cancel':
        if (this.touch?.id === id) this.cancel(time);
        break;
    }
  }

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

  private down(id: number, x: number, y: number, time: number): void {
    const path = hitTest(this.engine, x, y) ?? [];
    const target = path[path.length - 1] ?? this.engine.appRoot.root;
    const scrolls = path.filter((n) => n.kind === 'scroll').reverse();
    let absorbed = false;
    for (const s of scrolls) if (this.engine.scrolls.touchDown(s)) absorbed = true;
    const touch: Touch = {
      id, path, target, startX: x, startY: y, startTime: time, x, y, prevX: x, prevY: y, time, prevTime: time,
      scroll: null, scrollCandidates: scrolls, control: null, absorbed,
    };
    this.touch = touch;
    if (absorbed) return;

    if (target.kind === 'switch' && !target.props.disabled) {
      touch.control = target;
      this.engine.behaviors.controlPress(target, true);
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
    for (const node of path) {
      if (this.ask(node, 'onStartShouldSetResponderCapture', e())) {
        granted = node;
        break;
      }
    }
    if (!granted) {
      for (let i = path.length - 1; i >= 0; i--) {
        if (this.ask(path[i]!, 'onStartShouldSetResponder', e())) {
          granted = path[i]!;
          break;
        }
      }
    }
    if (granted) this.grant(granted, touch, time);
    else this.dispatchTouch('onTouchStart', touch, time);
  }

  private move(x: number, y: number, time: number): void {
    const touch = this.touch!;
    touch.prevX = touch.x;
    touch.prevY = touch.y;
    touch.prevTime = touch.time;
    touch.x = x;
    touch.y = y;
    touch.time = time;
    if (touch.absorbed && !touch.scroll) {
      this.maybeStartScroll(touch, time);
      return;
    }
    if (touch.scroll) {
      this.engine.scrolls.drag(touch.scroll, x, y, time);
      return;
    }
    if (this.maybeStartScroll(touch, time)) return;
    if (touch.control) {
      const r = this.engine.geometry.windowRect(touch.control);
      const inside = x >= r.x - 20 && y >= r.y - 20 && x <= r.x + r.w + 20 && y <= r.y + r.h + 20;
      this.engine.behaviors.controlPress(touch.control, inside);
      return;
    }
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
      else this.dispatchTouch('onTouchMove', touch, time);
    }
  }

  private maybeStartScroll(touch: Touch, time: number): boolean {
    if (!touch.scrollCandidates.length) return false;
    const dx = touch.x - touch.startX;
    const dy = touch.y - touch.startY;
    const slop = this.engine.kit.scroll.touchSlop;
    if (Math.abs(dx) < slop && Math.abs(dy) < slop) return false;
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const scroll = touch.scrollCandidates.find((s) => this.engine.scrolls.scrollable(s, axis));
    if (!scroll) return false;
    // The scroll view takes the gesture: cancel whatever JS had.
    if (this.responder) this.terminate(touch, time);
    if (touch.control) {
      this.engine.behaviors.controlPress(touch.control, false);
      touch.control = null;
    }
    touch.scroll = scroll;
    this.engine.scrolls.beginDrag(scroll, touch.startX, touch.startY, touch.startTime);
    this.engine.scrolls.drag(scroll, touch.x, touch.y, time);
    return true;
  }

  private up(x: number, y: number, time: number): void {
    const touch = this.touch!;
    touch.prevX = touch.x;
    touch.prevY = touch.y;
    touch.x = x;
    touch.y = y;
    touch.time = time;
    this.touch = null;
    if (touch.scroll) {
      this.engine.scrolls.endDrag(touch.scroll, time);
      return;
    }
    if (touch.absorbed) return;
    if (touch.control) {
      const r = this.engine.geometry.windowRect(touch.control);
      const inside = x >= r.x - 20 && y >= r.y - 20 && x <= r.x + r.w + 20 && y <= r.y + r.h + 20;
      this.engine.behaviors.controlPress(touch.control, false);
      if (inside) this.engine.behaviors.toggleSwitch(touch.control);
      return;
    }
    if (this.responder) {
      const responder = this.responder;
      this.responder = null;
      this.call(responder, 'onResponderRelease', this.event('touchend', touch, time, true));
    } else {
      this.dispatchTouch('onTouchEnd', touch, time, true);
    }
  }

  private cancel(time: number): void {
    const touch = this.touch!;
    this.touch = null;
    if (touch.scroll) this.engine.scrolls.endDrag(touch.scroll, time);
    if (touch.control) this.engine.behaviors.controlPress(touch.control, false);
    if (this.responder) this.terminate(touch, time);
  }

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
