import type { CGPoint } from '../core-graphics/geometry';
import { UITouchPhase, type UIEvent, type UITouch } from './ui-event';
import type { UIView } from './ui-view';

/**
 * UIGestureRecognizer and the gesture environment that arbitrates between
 * recognizers sharing touches:
 *
 * - A recognizer moving out of `possible` (began, or ended for discrete
 *   ones) first asks `gestureRecognizerShouldBegin` (its delegate, then its
 *   view); a no fails it.
 * - It waits while a recognizer it must fail-require (`require(toFail:)`,
 *   `shouldRequireFailureOf`, the other's `shouldBeRequiredToFailBy`) is
 *   still possible; it fails if that one recognizes.
 * - An already-active recognizer that may not run alongside it prevents it
 *   (it fails); otherwise it begins and fails every still-possible
 *   recognizer it may not run alongside. "Alongside" means either delegate
 *   answered `shouldRecognizeSimultaneouslyWith` with yes.
 * - Beginning cancels its touches in their views (`cancelsTouchesInView`).
 * - When every touch has ended, recognizers that are still possible fail,
 *   and all of them reset.
 */
export enum UIGestureRecognizerState { possible = 0, began = 1, changed = 2, ended = 3, cancelled = 4, failed = 5 }
export const UIGestureRecognizerStateRecognized = UIGestureRecognizerState.ended;

export interface UIGestureRecognizerDelegate {
  gestureRecognizerShouldBegin?(recognizer: UIGestureRecognizer): boolean;
  shouldRecognizeSimultaneously?(recognizer: UIGestureRecognizer, other: UIGestureRecognizer): boolean;
  shouldRequireFailureOf?(recognizer: UIGestureRecognizer, other: UIGestureRecognizer): boolean;
  shouldBeRequiredToFailBy?(recognizer: UIGestureRecognizer, other: UIGestureRecognizer): boolean;
  shouldReceiveTouch?(recognizer: UIGestureRecognizer, touch: UITouch): boolean;
}

type Action = (recognizer: UIGestureRecognizer) => void;

export class UIGestureRecognizer {
  private _state = UIGestureRecognizerState.possible;
  private _view: UIView | null = null;
  private readonly actions: Action[] = [];
  private readonly failureRequirements = new Set<UIGestureRecognizer>();
  /** a transition held back until the recognizers this one requires to fail have failed */
  private pending: UIGestureRecognizerState | null = null;
  /** @internal touches this recognizer is tracking */
  readonly _touches = new Set<UITouch>();
  /** @internal the environment of the current touch sequence */
  _environment: GestureEnvironment | null = null;

  delegate: UIGestureRecognizerDelegate | null = null;
  isEnabled = true;
  cancelsTouchesInView = true;
  delaysTouchesBegan = false;
  delaysTouchesEnded = true;
  name: string | null = null;

  constructor(action?: Action) {
    if (action) this.actions.push(action);
  }

  addTarget(action: Action): void {
    this.actions.push(action);
  }

  removeTarget(action: Action): void {
    const at = this.actions.indexOf(action);
    if (at >= 0) this.actions.splice(at, 1);
  }

  get view(): UIView | null {
    return this._view;
  }

  /** @internal */
  _setView(view: UIView | null): void {
    this._view = view;
  }

  require(toFail: UIGestureRecognizer): void {
    this.failureRequirements.add(toFail);
  }

  // ── state ─────────────────────────────────────────────────────────────

  get state(): UIGestureRecognizerState {
    return this._state;
  }

  /** Subclasses move through states by assigning; the environment arbitrates. */
  set state(next: UIGestureRecognizerState) {
    const env = this._environment;
    if (!env) {
      this._state = next;
      return;
    }
    env.transition(this, next);
  }

  /** @internal set without arbitration */
  _applyState(next: UIGestureRecognizerState): void {
    this._state = next;
    this._sendActions();
  }

  /** @internal set the state only (arbitration in progress) */
  _setState(next: UIGestureRecognizerState): void {
    this._state = next;
  }

  /** @internal tell the targets about the current state */
  _sendActions(): void {
    const s = this._state;
    if (s === UIGestureRecognizerState.possible || s === UIGestureRecognizerState.failed) return;
    for (const action of this.actions.slice()) action(this);
  }

  /** @internal */
  get _pending(): UIGestureRecognizerState | null {
    return this.pending;
  }

  /** @internal */
  _setPending(state: UIGestureRecognizerState | null): void {
    this.pending = state;
  }

  get isActive(): boolean {
    return this._state === UIGestureRecognizerState.began || this._state === UIGestureRecognizerState.changed;
  }

  get isFinished(): boolean {
    return this._state === UIGestureRecognizerState.ended || this._state === UIGestureRecognizerState.cancelled || this._state === UIGestureRecognizerState.failed;
  }

  /** Must this recognizer wait for `other` to fail? */
  requiresFailureOf(other: UIGestureRecognizer): boolean {
    if (this.failureRequirements.has(other)) return true;
    if (this.delegate?.shouldRequireFailureOf?.(this, other)) return true;
    if (other.delegate?.shouldBeRequiredToFailBy?.(other, this)) return true;
    return this.shouldRequireFailure(other) || other.shouldBeRequiredToFail(this);
  }

  /** subclass hooks (UIKit's overridable versions of the delegate methods) */
  shouldRequireFailure(_other: UIGestureRecognizer): boolean {
    return false;
  }

  shouldBeRequiredToFail(_other: UIGestureRecognizer): boolean {
    return false;
  }

  canPrevent(_other: UIGestureRecognizer): boolean {
    return true;
  }

  canBePrevented(_by: UIGestureRecognizer): boolean {
    return true;
  }

  /** May these two recognize at the same time? */
  recognizesSimultaneously(other: UIGestureRecognizer): boolean {
    return !!(this.delegate?.shouldRecognizeSimultaneously?.(this, other) || other.delegate?.shouldRecognizeSimultaneously?.(other, this));
  }

  // ── touches (override in subclasses) ──────────────────────────────────

  touchesBegan(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {}
  touchesMoved(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {}
  touchesEnded(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {}
  touchesCancelled(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    if (this.isActive) this.state = UIGestureRecognizerState.cancelled;
    else if (this._state === UIGestureRecognizerState.possible) this.state = UIGestureRecognizerState.failed;
  }

  /** Back to `possible` after a sequence; subclasses clear their tracking state. */
  reset(): void {}

  /** Stop delivering `touch` to this recognizer. */
  ignore(touch: UITouch): void {
    this._touches.delete(touch);
  }

  get numberOfTouches(): number {
    let n = 0;
    for (const t of this._touches) if (t.phase !== UITouchPhase.ended && t.phase !== UITouchPhase.cancelled) n++;
    return n;
  }

  /** Centroid of the tracked touches in `view` coordinates. */
  location(view: UIView | null): CGPoint {
    const touches = Array.from(this._touches);
    if (!touches.length) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const t of touches) {
      const p = t.location(view);
      x += p.x;
      y += p.y;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  locationOfTouch(index: number, view: UIView | null): CGPoint {
    const t = Array.from(this._touches)[index];
    return t ? t.location(view) : { x: 0, y: 0 };
  }
}

/** Arbitration for one touch sequence in a window. */
export class GestureEnvironment {
  readonly recognizers = new Set<UIGestureRecognizer>();

  constructor(private readonly cancelTouchesInViews: (recognizer: UIGestureRecognizer) => void) {}

  add(recognizer: UIGestureRecognizer): void {
    if (this.recognizers.has(recognizer)) return;
    this.recognizers.add(recognizer);
    recognizer._environment = this;
  }

  transition(r: UIGestureRecognizer, next: UIGestureRecognizerState): void {
    const S = UIGestureRecognizerState;
    const from = r.state;
    if (from === next && next !== S.changed) return;
    // Leaving `possible`: may it begin at all?
    if (from === S.possible && (next === S.began || next === S.ended)) {
      if (!this.shouldBegin(r)) {
        this.fail(r);
        return;
      }
      for (const other of this.recognizers) {
        if (other === r || other.recognizesSimultaneously(r)) continue;
        if (other.isActive && other.canPrevent(r) && r.canBePrevented(other)) {
          this.fail(r);
          return;
        }
      }
      const waitingOn = this.blockers(r);
      if (waitingOn.length) {
        r._setPending(next);
        return;
      }
      this.begin(r, next);
      return;
    }
    if (from === S.possible && (next === S.failed || next === S.cancelled)) {
      this.fail(r);
      return;
    }
    if (r.isFinished && next !== S.possible) return;
    r._applyState(next);
    if (next === S.ended || next === S.cancelled) this.settle();
  }

  private shouldBegin(r: UIGestureRecognizer): boolean {
    if (r.delegate?.gestureRecognizerShouldBegin && !r.delegate.gestureRecognizerShouldBegin(r)) return false;
    if (r.view && !r.view.gestureRecognizerShouldBegin(r)) return false;
    return true;
  }

  /** Recognizers `r` must wait for (required to fail and still undecided). */
  private blockers(r: UIGestureRecognizer): UIGestureRecognizer[] {
    const out: UIGestureRecognizer[] = [];
    for (const other of this.recognizers) {
      if (other === r || !r.requiresFailureOf(other)) continue;
      if (other.state === UIGestureRecognizerState.possible) out.push(other);
    }
    return out;
  }

  private begin(r: UIGestureRecognizer, next: UIGestureRecognizerState): void {
    r._setPending(null);
    // The new state is visible while the others are asked (their hooks may look at it).
    r._setState(next);
    // It begins: every undecided recognizer it may not run alongside fails. Active
    // ones are asked too — UIKit does, and some act on it (React Native's touch
    // handler cancels its JS touches when a scroll view's pan begins).
    for (const other of this.recognizers) {
      if (other === r || other.recognizesSimultaneously(r) || other.isFinished) continue;
      const prevented = r.canPrevent(other) && other.canBePrevented(r);
      if (prevented && other.state === UIGestureRecognizerState.possible) this.fail(other);
    }
    if (r.cancelsTouchesInView) this.cancelTouchesInViews(r);
    r._sendActions();
    this.settle();
  }

  private fail(r: UIGestureRecognizer): void {
    const wasPossible = r.state === UIGestureRecognizerState.possible;
    r._setPending(null);
    r._applyState(UIGestureRecognizerState.failed);
    if (!wasPossible) return;
    // Anyone waiting on it may now go ahead.
    this.settle();
  }

  /** Resolve recognizers waiting for others to fail. */
  private settle(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const r of this.recognizers) {
        const pending = r._pending;
        if (pending == null || r.state !== UIGestureRecognizerState.possible) continue;
        const requirements = Array.from(this.recognizers).filter((o) => o !== r && r.requiresFailureOf(o));
        if (requirements.some((o) => o.state === UIGestureRecognizerState.began || o.state === UIGestureRecognizerState.changed || o.state === UIGestureRecognizerState.ended)) {
          this.fail(r);
          progressed = true;
          continue;
        }
        if (requirements.every((o) => o.state === UIGestureRecognizerState.failed || o.state === UIGestureRecognizerState.cancelled)) {
          this.begin(r, pending);
          progressed = true;
        }
      }
    }
  }

  /** Every touch of the sequence ended: undecided recognizers fail, then all reset. */
  finish(): void {
    for (const r of this.recognizers) {
      if (r.state === UIGestureRecognizerState.possible && r._pending == null) this.fail(r);
    }
    for (const r of this.recognizers) {
      if (r.state === UIGestureRecognizerState.possible && r._pending != null) this.fail(r);
    }
    for (const r of this.recognizers) {
      r._environment = null;
      r._touches.clear();
      r._setPending(null);
      r._applyState(UIGestureRecognizerState.possible);
      r.reset();
    }
    this.recognizers.clear();
  }
}
