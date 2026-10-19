import type { Engine } from '../../engine';
import type { HostNode } from '../../tree/node';
import { createRecognizer, NativeRecognizer, normalizeHitSlop, type ArenaHost, type Recognizer } from './recognizers';
import {
  GestureState, TouchEventType, type GestureConfig, type GestureEventData, type GestureKind, type GestureListener,
  type GestureRelations, type GestureStateValue, type PointerSample, type TouchData, type TouchEventTypeValue,
} from './types';

/**
 * The gesture arena: react-native-gesture-handler's orchestrator, in the engine.
 *
 * Handlers are created by tag (the JS gesture API owns the tags) and attached
 * to host nodes. Every pointer that lands on an attached node (or inside its
 * hitSlop) makes that handler a participant of the current touch sequence.
 * Recognizers decide when they want to begin, activate or end; the arena
 * decides whether they may:
 *
 * - A handler can't activate while another participant it may not run
 *   alongside is active (or while a native scroll it isn't simultaneous with
 *   is dragging); it fails instead.
 * - A handler that must wait for others (`waitFor`, or another's `blocks`)
 *   stays BEGAN until they fail; if one of them succeeds it fails.
 * - Activation cancels every participant it isn't simultaneous with, cancels
 *   the JS responder (Pressable & co.) and keeps native scroll views from
 *   starting — the way RNGH's root view cancels touches on device.
 * - A scroll view starting to drag is the activation of its native gesture:
 *   it cancels every participant that isn't simultaneous with it.
 */
export class GestureArena implements ArenaHost {
  private readonly handlers = new Map<number, Recognizer>();
  /** handlers taking part in the current touch sequence */
  private readonly participants = new Set<Recognizer>();
  /** the scroll view currently dragged by the touch, if any */
  private draggingScroll: HostNode | null = null;

  constructor(private readonly engine: Engine) {}

  // ── ArenaHost (services for recognizers) ─────────────────────────────

  get touchSlop(): number {
    return this.engine.kit.scroll.touchSlop;
  }

  toLocal(node: HostNode, x: number, y: number): [number, number] {
    return this.engine.geometry.toLocal(node, x, y);
  }

  setTimeout(fn: () => void, ms: number): unknown {
    return this.engine.clock.setTimeout(() => {
      fn();
      this.engine.requestFrame();
    }, ms);
  }

  clearTimeout(handle: unknown): void {
    this.engine.clock.clearTimeout(handle);
  }

  // ── handler registry (driven by the JS gesture API) ──────────────────

  create(tag: number, kind: GestureKind, listener: GestureListener): void {
    this.drop(tag);
    this.handlers.set(tag, createRecognizer(tag, kind, listener, this));
  }

  configure(tag: number, config: GestureConfig, relations?: GestureRelations): void {
    const r = this.handlers.get(tag);
    if (!r) return;
    r.config = config;
    if (relations) r.relations = relations;
    if (config.enabled === false && !r.finished && r.state !== GestureState.UNDETERMINED) this.cancel(r);
  }

  attach(tag: number, node: HostNode | null): void {
    const r = this.handlers.get(tag);
    if (!r || r.node === node) return;
    if (r.node && r.state !== GestureState.UNDETERMINED && !r.finished) this.cancel(r);
    r.node = node;
  }

  drop(tag: number): void {
    const r = this.handlers.get(tag);
    if (!r) return;
    this.handlers.delete(tag);
    this.participants.delete(r);
    r.reset();
  }

  has(tag: number): boolean {
    return this.handlers.has(tag);
  }

  /** A host node is gone: its handlers stay registered but detach. */
  nodeDestroyed(node: HostNode): void {
    for (const r of this.handlers.values()) {
      if (r.node !== node) continue;
      this.participants.delete(r);
      r.reset();
      r.node = null;
    }
  }

  /**
   * Manual control (GestureStateManager): begin, activate, end or fail a
   * handler regardless of its own recognition — `manualActivation` gestures
   * activate only this way.
   */
  setState(tag: number, state: GestureStateValue): void {
    const r = this.handlers.get(tag);
    if (!r?.node) return;
    switch (state) {
      case GestureState.BEGAN:
        if (r.state === GestureState.UNDETERMINED) {
          this.participants.add(r);
          this.transition(r, GestureState.BEGAN);
        }
        break;
      case GestureState.ACTIVE:
        if (r.state === GestureState.UNDETERMINED) {
          this.participants.add(r);
          this.transition(r, GestureState.BEGAN);
        }
        this.tryActivate(r);
        break;
      case GestureState.END:
        if (r.state === GestureState.ACTIVE) this.transition(r, GestureState.END);
        else if (r.state === GestureState.BEGAN) this.transition(r, GestureState.FAILED);
        break;
      case GestureState.FAILED:
      case GestureState.CANCELLED:
        this.cancel(r, state);
        break;
    }
  }

  // ── pointer input (driven by PointerInput) ───────────────────────────

  /** True while a gesture that isn't a scroll view's own owns the touch. */
  get ownsTouch(): boolean {
    for (const r of this.participants) {
      if (r.state === GestureState.ACTIVE && !(r instanceof NativeRecognizer && r.wrapsScroll)) return true;
    }
    return false;
  }

  pointerDown(p: PointerSample, path: HostNode[]): void {
    const candidates = this.candidatesAt(p, path);
    // A new touch somewhere else ends multi-tap sequences waiting for it.
    if (!this.anyPointersDown()) {
      for (const r of Array.from(this.participants)) {
        if (!candidates.includes(r) && r.state === GestureState.BEGAN && !r.awaiting) this.cancel(r, GestureState.FAILED);
      }
    }
    for (const r of candidates) {
      if (r.finished) continue;
      this.participants.add(r);
      r.pointerDown(p);
      this.touches(r, TouchEventType.TOUCHES_DOWN, p);
    }
    this.cleanup();
  }

  pointerMove(p: PointerSample): void {
    for (const r of Array.from(this.participants)) {
      if (!r.pointers.has(p.id) || r.finished) continue;
      if (r.cancelsWhenOutside && r.state !== GestureState.UNDETERMINED && r.isOutside(p)) {
        this.cancel(r, r.state === GestureState.ACTIVE ? GestureState.CANCELLED : GestureState.FAILED);
        continue;
      }
      r.pointerMove(p);
      this.touches(r, TouchEventType.TOUCHES_MOVE, p);
    }
  }

  pointerUp(p: PointerSample): void {
    for (const r of Array.from(this.participants)) {
      if (!r.pointers.has(p.id)) continue;
      r.pointerUp(p);
      this.touches(r, TouchEventType.TOUCHES_UP, p, true);
    }
    this.cleanup();
  }

  pointerCancel(p: PointerSample): void {
    for (const r of Array.from(this.participants)) {
      if (!r.pointers.has(p.id)) continue;
      this.touches(r, TouchEventType.TOUCHES_CANCELLED, p, true);
      r.pointerCancel();
    }
    this.cleanup();
  }

  // ── native scrolling ─────────────────────────────────────────────────

  /** May this scroll view start dragging, given the gestures already active? */
  canScroll(scroll: HostNode): boolean {
    const natives = this.nativesOf(scroll);
    for (const r of this.participants) {
      if (r.state !== GestureState.ACTIVE || (natives as Recognizer[]).includes(r)) continue;
      if (!natives.some((n) => this.simultaneous(r, n))) return false;
    }
    return true;
  }

  /** The scroll view took the touch: its native gesture activates, competitors are cancelled. */
  scrollStarted(scroll: HostNode): void {
    this.draggingScroll = scroll;
    const natives = this.nativesOf(scroll);
    for (const n of natives) n.scrollStarted();
    for (const r of Array.from(this.participants)) {
      if ((natives as Recognizer[]).includes(r) || r.finished || r.state === GestureState.UNDETERMINED) continue;
      if (!natives.some((n) => this.simultaneous(r, n))) this.cancel(r);
    }
  }

  scrollEnded(scroll: HostNode): void {
    if (this.draggingScroll === scroll) this.draggingScroll = null;
    for (const n of this.nativesOf(scroll)) n.scrollEnded();
    this.cleanup();
  }

  // ── state machine (called by recognizers) ────────────────────────────

  transition(r: Recognizer, state: GestureStateValue): void {
    const oldState = r.state;
    if (oldState === state || r.finished) return;
    r.state = state;
    if (state !== GestureState.BEGAN) r.awaiting = false;
    this.announce(r, oldState);
  }

  /** Tell the handler's owner about the state it is now in. */
  private announce(r: Recognizer, oldState: GestureStateValue): void {
    const event = { ...this.base(r), state: r.state, oldState };
    this.dispatch(() => r.listener.onStateChange(event), 'discrete');
    if (r.finished) this.finished(r);
  }

  tryActivate(r: Recognizer): void {
    if (r.state !== GestureState.BEGAN) return;
    for (const o of this.participants) {
      if (o !== r && o.state === GestureState.ACTIVE && !this.simultaneous(r, o)) return this.transition(r, GestureState.FAILED);
    }
    if (this.draggingScroll && !(r instanceof NativeRecognizer && r.node === this.draggingScroll)) {
      const natives = this.nativesOf(this.draggingScroll);
      if (!natives.some((n) => this.simultaneous(r, n))) return this.transition(r, GestureState.FAILED);
    }
    for (const o of this.participants) {
      if (o !== r && !o.finished && o.state !== GestureState.UNDETERMINED && this.waitsFor(r, o)) {
        r.awaiting = true;
        return;
      }
    }
    r.awaiting = false;
    // Claim the touch before anyone hears about it: competitors, the JS
    // responder and control presses are cancelled, then onStart runs.
    r.state = GestureState.ACTIVE;
    if (!(r instanceof NativeRecognizer && r.wrapsScroll)) this.engine.input.gestureActivated(r.config.cancelsJSResponder !== false);
    for (const o of Array.from(this.participants)) {
      if (o === r || o.finished || o.state === GestureState.UNDETERMINED || this.simultaneous(r, o)) continue;
      this.cancel(o);
    }
    this.announce(r, GestureState.BEGAN);
    if ((r.state as GestureStateValue) !== GestureState.ACTIVE) return;
    r.activated();
    this.engine.requestFrame();
  }

  emitUpdate(r: Recognizer): void {
    const event = { ...this.base(r), state: r.state };
    this.dispatch(() => r.listener.onUpdate(event), 'continuous');
  }

  // ── internals ────────────────────────────────────────────────────────

  private cancel(r: Recognizer, state: GestureStateValue = GestureState.CANCELLED): void {
    if (r.finished || r.state === GestureState.UNDETERMINED) return;
    this.transition(r, r.state === GestureState.ACTIVE || state === GestureState.CANCELLED ? GestureState.CANCELLED : GestureState.FAILED);
  }

  /** A participant finished: release handlers waiting on it, reset it once its pointers are up. */
  private finished(r: Recognizer): void {
    const succeeded = r.state === GestureState.END;
    for (const o of Array.from(this.participants)) {
      if (o === r || !o.awaiting || !this.waitsFor(o, r)) continue;
      if (succeeded) this.transition(o, GestureState.FAILED);
      else this.tryActivate(o);
    }
    if (!r.pointers.size) this.retire(r);
  }

  private retire(r: Recognizer): void {
    this.participants.delete(r);
    r.reset();
  }

  /** Drop participants that are done and no longer hold pointers. */
  private cleanup(): void {
    for (const r of Array.from(this.participants)) {
      if (!r.pointers.size && (r.finished || r.state === GestureState.UNDETERMINED)) this.retire(r);
    }
  }

  private anyPointersDown(): boolean {
    for (const r of this.participants) if (r.pointers.size) return true;
    return false;
  }

  /** Handlers under the pointer: attached to a node on the hit path, or reaching it through hitSlop. Innermost first. */
  private candidatesAt(p: PointerSample, path: HostNode[]): Recognizer[] {
    const depth = new Map(path.map((n, i) => [n, i] as const));
    const out: Array<{ r: Recognizer; d: number }> = [];
    for (const r of this.handlers.values()) {
      if (!r.enabled || !r.node) continue;
      const d = depth.get(r.node);
      if (d !== undefined) {
        if (r.config.hitSlop == null || !r.isOutside(p)) out.push({ r, d });
      } else if (r.config.hitSlop != null && r.node.laidOut) {
        const [lx, ly] = this.toLocal(r.node, p.x, p.y);
        const s = normalizeHitSlop(r.config.hitSlop, r.node.w, r.node.h);
        if (lx >= s.left && ly >= s.top && lx <= s.right && ly <= s.bottom) out.push({ r, d: -1 });
      }
    }
    return out.sort((a, b) => b.d - a.d).map((x) => x.r);
  }

  private nativesOf(scroll: HostNode): NativeRecognizer[] {
    const out: NativeRecognizer[] = [];
    for (const r of this.participants) if (r instanceof NativeRecognizer && r.node === scroll) out.push(r);
    return out;
  }

  private simultaneous(a: Recognizer, b: Recognizer): boolean {
    return a.relations.simultaneousWith.includes(b.tag) || b.relations.simultaneousWith.includes(a.tag);
  }

  private waitsFor(a: Recognizer, b: Recognizer): boolean {
    return a.relations.waitFor.includes(b.tag) || b.relations.blocks.includes(a.tag);
  }

  private base(r: Recognizer): GestureEventData {
    return { handlerTag: r.tag, state: r.state, numberOfPointers: r.pointers.size, pointerType: 0, ...r.payload() };
  }

  private touches(r: Recognizer, type: TouchEventTypeValue, changed: PointerSample, lifted = false): void {
    if (!r.listener.onTouches || !r.config.needsPointerData || !r.node) return;
    const node = r.node;
    const data = (id: number, x: number, y: number): TouchData => {
      const [lx, ly] = this.toLocal(node, x, y);
      return { id, x: lx, y: ly, absoluteX: x, absoluteY: y };
    };
    const all = Array.from(r.pointers.values()).filter((t) => !(lifted && t.id === changed.id)).map((t) => data(t.id, t.x, t.y));
    const event = {
      handlerTag: r.tag,
      numberOfTouches: all.length,
      state: r.state,
      eventType: type,
      allTouches: all,
      changedTouches: [data(changed.id, changed.x, changed.y)],
      pointerType: 0,
    };
    this.dispatch(() => r.listener.onTouches!(event), type === TouchEventType.TOUCHES_MOVE ? 'continuous' : 'discrete');
  }

  private dispatch(fn: () => void, priority: 'discrete' | 'continuous'): void {
    this.engine.events.run(fn, priority);
  }
}
