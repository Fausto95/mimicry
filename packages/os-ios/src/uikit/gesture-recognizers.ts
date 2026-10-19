import type { CGPoint } from '../core-graphics/geometry';
import { UITouchPhase, type UIEvent, type UITouch } from './ui-event';
import { UIGestureRecognizer, UIGestureRecognizerState as S } from './ui-gesture-recognizer';
import type { UIView } from './ui-view';

/**
 * UIKit's concrete gesture recognizers. Thresholds are UIKit's: a pan
 * begins after 10 pt of movement, a tap fails after 45 pt or (for multiple
 * taps) a 350 ms gap, a long press needs 0.5 s within 10 pt.
 */
const PAN_SLOP = 10;
const TAP_SLOP = 45;
const MULTI_TAP_GAP = 350;

function centroid(touches: Iterable<UITouch>, view: UIView | null): CGPoint {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const t of touches) {
    if (t.phase === UITouchPhase.ended || t.phase === UITouchPhase.cancelled) continue;
    const p = t.location(view);
    x += p.x;
    y += p.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

function timers(r: UIGestureRecognizer) {
  return r.view?.window?.application?.clock ?? null;
}

// ── tap ──────────────────────────────────────────────────────────────────

export class UITapGestureRecognizer extends UIGestureRecognizer {
  numberOfTapsRequired = 1;
  numberOfTouchesRequired = 1;
  private taps = 0;
  private start: CGPoint | null = null;
  private gapTimer: unknown = null;

  override touchesBegan(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    this.clearTimer();
    if (this.numberOfTouches > this.numberOfTouchesRequired) {
      this.state = S.failed;
      return;
    }
    if (!this.start) this.start = centroid(touches, null);
  }

  override touchesMoved(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    const p = centroid(touches, null);
    if (this.start && Math.hypot(p.x - this.start.x, p.y - this.start.y) > TAP_SLOP) this.state = S.failed;
  }

  override touchesEnded(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    if (this.numberOfTouches > 0) return;
    this.taps++;
    if (this.taps >= this.numberOfTapsRequired) {
      this.state = S.ended;
      return;
    }
    const clock = timers(this);
    if (clock) this.gapTimer = clock.setTimeout(() => {
      if (this.state === S.possible) this.state = S.failed;
    }, MULTI_TAP_GAP);
  }

  override reset(): void {
    this.taps = 0;
    this.start = null;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.gapTimer != null) timers(this)?.clearTimeout(this.gapTimer);
    this.gapTimer = null;
  }
}

// ── long press ───────────────────────────────────────────────────────────

export class UILongPressGestureRecognizer extends UIGestureRecognizer {
  minimumPressDuration = 0.5;
  numberOfTouchesRequired = 1;
  allowableMovement = 10;
  private start: CGPoint | null = null;
  private timer: unknown = null;

  override touchesBegan(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    if (this.numberOfTouches !== this.numberOfTouchesRequired) {
      if (this.numberOfTouches > this.numberOfTouchesRequired) this.state = this.isActive ? S.cancelled : S.failed;
      return;
    }
    this.start = centroid(touches, null);
    const clock = timers(this);
    if (clock) this.timer = clock.setTimeout(() => {
      this.timer = null;
      if (this.state === S.possible) this.state = S.began;
    }, this.minimumPressDuration * 1000);
  }

  override touchesMoved(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    const p = centroid(touches, null);
    if (this.state === S.possible) {
      if (this.start && Math.hypot(p.x - this.start.x, p.y - this.start.y) > this.allowableMovement) this.state = S.failed;
    } else if (this.isActive) {
      this.state = S.changed;
    }
  }

  override touchesEnded(_touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    if (this.isActive) this.state = S.ended;
    else if (this.state === S.possible) this.state = S.failed;
  }

  override reset(): void {
    if (this.timer != null) timers(this)?.clearTimeout(this.timer);
    this.timer = null;
    this.start = null;
  }
}

// ── pan ──────────────────────────────────────────────────────────────────

export class UIPanGestureRecognizer extends UIGestureRecognizer {
  minimumNumberOfTouches = 1;
  maximumNumberOfTouches = Infinity;
  /** movement (pt) before the pan begins */
  protected slop = PAN_SLOP;
  private origin: CGPoint | null = null;
  private offset: CGPoint = { x: 0, y: 0 };
  private samples: Array<{ t: number; x: number; y: number }> = [];

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (this.numberOfTouches > this.maximumNumberOfTouches) {
      for (const t of touches) this.ignore(t);
      return;
    }
    // A new finger re-bases the translation so the centroid jump is not a movement.
    const current = centroid(this._touches, null);
    if (this.origin) {
      const before = this.translation(null);
      this.origin = current;
      this.offset = before;
    } else {
      this.origin = current;
    }
    this.sample(event.timestamp);
  }

  override touchesMoved(_touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.sample(event.timestamp);
    if (this.state === S.possible) {
      if (this.numberOfTouches < this.minimumNumberOfTouches) return;
      const t = this.translation(null);
      if (this.shouldBeginPan(t)) this.state = S.began;
    } else if (this.isActive) {
      this.state = S.changed;
    }
  }

  override touchesEnded(_touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.sample(event.timestamp);
    if (this.numberOfTouches > 0) {
      // Remaining fingers keep the pan going from where it is.
      const before = this.translation(null);
      this.origin = centroid(this._touches, null);
      this.offset = before;
      return;
    }
    if (this.isActive) this.state = S.ended;
    else if (this.state === S.possible) this.state = S.failed;
  }

  /** Whether movement `t` (window points) is enough to begin; subclasses restrict direction. */
  protected shouldBeginPan(t: CGPoint): boolean {
    return Math.hypot(t.x, t.y) >= this.slop;
  }

  /** Translation since the gesture started, in `view` coordinates (window when null). */
  translation(view: UIView | null): CGPoint {
    if (!this.origin) return { x: 0, y: 0 };
    const now = centroid(this._touches, null);
    const dx = now.x - this.origin.x + this.offset.x;
    const dy = now.y - this.origin.y + this.offset.y;
    if (!view) return { x: dx, y: dy };
    const a = view.convertPointFrom({ x: 0, y: 0 }, null);
    const b = view.convertPointFrom({ x: dx, y: dy }, null);
    return { x: b.x - a.x, y: b.y - a.y };
  }

  setTranslation(translation: CGPoint, _view: UIView | null): void {
    this.origin = centroid(this._touches, null);
    this.offset = translation;
  }

  /** Points per second over the last ~80 ms. */
  velocity(_view: UIView | null): CGPoint {
    const recent = this.samples;
    if (recent.length < 2) return { x: 0, y: 0 };
    const last = recent[recent.length - 1]!;
    const first = recent.find((s) => last.t - s.t <= 80) ?? recent[0]!;
    const dt = Math.max(1, last.t - first.t);
    return { x: ((last.x - first.x) / dt) * 1000, y: ((last.y - first.y) / dt) * 1000 };
  }

  private sample(time: number): void {
    const p = centroid(this._touches, null);
    this.samples.push({ t: time, x: p.x, y: p.y });
    if (this.samples.length > 12) this.samples.shift();
  }

  override reset(): void {
    this.origin = null;
    this.offset = { x: 0, y: 0 };
    this.samples = [];
  }
}

export enum UIRectEdge { none = 0, top = 1, left = 2, bottom = 4, right = 8, all = 15 }

/** A pan that must start within 20 pt of a screen edge (interactive pop). */
export class UIScreenEdgePanGestureRecognizer extends UIPanGestureRecognizer {
  edges = UIRectEdge.left;
  private startedAtEdge = false;

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (!this._touches.size || this.numberOfTouches === touches.size) {
      const t = touches.values().next().value as UITouch | undefined;
      const window = t?.window;
      const p = t?.windowLocation;
      const w = window?.bounds.size.width ?? 0;
      this.startedAtEdge = !!p && ((this.edges & UIRectEdge.left) !== 0 && p.x <= 20 || (this.edges & UIRectEdge.right) !== 0 && p.x >= w - 20);
      if (!this.startedAtEdge) {
        this.state = S.failed;
        return;
      }
    }
    super.touchesBegan(touches, event);
  }

  protected override shouldBeginPan(t: CGPoint): boolean {
    return this.startedAtEdge && Math.abs(t.x) >= this.slop && Math.abs(t.x) > Math.abs(t.y);
  }
}

// ── swipe ────────────────────────────────────────────────────────────────

export enum UISwipeGestureRecognizerDirection { right = 1, left = 2, up = 4, down = 8 }

export class UISwipeGestureRecognizer extends UIGestureRecognizer {
  direction = UISwipeGestureRecognizerDirection.right;
  numberOfTouchesRequired = 1;
  private start: { x: number; y: number; t: number } | null = null;

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    const p = centroid(touches, null);
    this.start ??= { ...p, t: event.timestamp };
  }

  override touchesMoved(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (!this.start || this.state !== S.possible) return;
    const p = centroid(this._touches, null);
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    const dt = event.timestamp - this.start.t;
    if (dt > 500) {
      this.state = S.failed;
      return;
    }
    const D = UISwipeGestureRecognizerDirection;
    const matched =
      (this.direction & D.right && dx > 50 && Math.abs(dy) < Math.abs(dx) / 2) ||
      (this.direction & D.left && dx < -50 && Math.abs(dy) < Math.abs(dx) / 2) ||
      (this.direction & D.down && dy > 50 && Math.abs(dx) < Math.abs(dy) / 2) ||
      (this.direction & D.up && dy < -50 && Math.abs(dx) < Math.abs(dy) / 2);
    if (matched) this.state = S.ended;
    void touches;
  }

  override touchesEnded(): void {
    if (this.state === S.possible && this.numberOfTouches === 0) this.state = S.failed;
  }

  override reset(): void {
    this.start = null;
  }
}

// ── pinch & rotation ─────────────────────────────────────────────────────

function pair(r: UIGestureRecognizer): [CGPoint, CGPoint] | null {
  const live = Array.from(r._touches).filter((t) => t.phase !== UITouchPhase.ended && t.phase !== UITouchPhase.cancelled);
  if (live.length < 2) return null;
  return [live[0]!.windowLocation, live[1]!.windowLocation];
}

export class UIPinchGestureRecognizer extends UIGestureRecognizer {
  scale = 1;
  velocity = 0;
  private initial = 0;
  private last = { scale: 1, t: 0 };

  override touchesBegan(): void {
    const p = pair(this);
    if (p && !this.initial) this.initial = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
  }

  override touchesMoved(_touches: ReadonlySet<UITouch>, event: UIEvent): void {
    const p = pair(this);
    if (!p || !this.initial) return;
    const d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    this.scale = d / this.initial;
    const dt = Math.max(1, event.timestamp - this.last.t);
    this.velocity = ((this.scale - this.last.scale) / dt) * 1000;
    this.last = { scale: this.scale, t: event.timestamp };
    if (this.state === S.possible && Math.abs(d - this.initial) > 8) this.state = S.began;
    else if (this.isActive) this.state = S.changed;
  }

  override touchesEnded(): void {
    if (pair(this)) return;
    if (this.isActive) this.state = S.ended;
    else if (this.state === S.possible) this.state = S.failed;
  }

  override reset(): void {
    this.scale = 1;
    this.velocity = 0;
    this.initial = 0;
    this.last = { scale: 1, t: 0 };
  }
}

export class UIRotationGestureRecognizer extends UIGestureRecognizer {
  rotation = 0;
  velocity = 0;
  private initial: number | null = null;

  override touchesBegan(): void {
    const p = pair(this);
    if (p && this.initial === null) this.initial = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  }

  override touchesMoved(): void {
    const p = pair(this);
    if (!p || this.initial === null) return;
    const angle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    this.rotation = angle - this.initial;
    if (this.state === S.possible && Math.abs(this.rotation) > 0.1) this.state = S.began;
    else if (this.isActive) this.state = S.changed;
  }

  override touchesEnded(): void {
    if (pair(this)) return;
    if (this.isActive) this.state = S.ended;
    else if (this.state === S.possible) this.state = S.failed;
  }

  override reset(): void {
    this.rotation = 0;
    this.velocity = 0;
    this.initial = null;
  }
}
