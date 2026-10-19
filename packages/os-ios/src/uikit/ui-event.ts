import type { CGPoint } from '../core-graphics/geometry';
import type { UIGestureRecognizer } from './ui-gesture-recognizer';
import type { UIView } from './ui-view';
import type { UIWindow } from './ui-window';

/**
 * UITouch and UIEvent: one finger's track across a touch sequence, and the
 * event that carries the touches that changed. Locations are kept in window
 * coordinates; `location(in:)` converts.
 */
export enum UITouchPhase { began = 0, moved = 1, stationary = 2, ended = 3, cancelled = 4 }
export enum UIEventType { touches = 0, motion = 1, remoteControl = 2, presses = 3, scroll = 10 }

export class UITouch {
  phase: UITouchPhase = UITouchPhase.began;
  timestamp: number;
  tapCount = 1;
  /** the view the touch began in (hit-test result) */
  view: UIView | null = null;
  window: UIWindow | null = null;
  /** recognizers that receive this touch (from the hit view up to the window) */
  gestureRecognizers: UIGestureRecognizer[] = [];
  /** set when a recognizer cancelled the touch for its view (cancelsTouchesInView) */
  deliveredToViewCancelled = false;
  force = 1;
  majorRadius = 20;
  private windowX: number;
  private windowY: number;
  private previousX: number;
  private previousY: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;

  constructor(readonly identifier: number, x: number, y: number, time: number) {
    this.windowX = this.previousX = this.startX = x;
    this.windowY = this.previousY = this.startY = y;
    this.timestamp = this.startTime = time;
  }

  /** window coordinates */
  get windowLocation(): CGPoint {
    return { x: this.windowX, y: this.windowY };
  }

  get previousWindowLocation(): CGPoint {
    return { x: this.previousX, y: this.previousY };
  }

  location(view: UIView | null): CGPoint {
    if (!view) return this.windowLocation;
    const [x, y] = view.layer.convertFromWindow(this.windowX, this.windowY);
    return { x, y };
  }

  previousLocation(view: UIView | null): CGPoint {
    if (!view) return this.previousWindowLocation;
    const [x, y] = view.layer.convertFromWindow(this.previousX, this.previousY);
    return { x, y };
  }

  /** @internal the digitizer reported a new position */
  update(phase: UITouchPhase, x: number, y: number, time: number): void {
    this.previousX = this.windowX;
    this.previousY = this.windowY;
    this.windowX = x;
    this.windowY = y;
    this.phase = phase;
    this.timestamp = time;
    if (phase === UITouchPhase.ended || phase === UITouchPhase.cancelled) this.force = 0;
  }
}

export class UIEvent {
  readonly type = UIEventType.touches;

  constructor(
    readonly timestamp: number,
    private readonly touches: ReadonlySet<UITouch>,
  ) {}

  get allTouches(): ReadonlySet<UITouch> {
    return this.touches;
  }

  touchesFor(view: UIView): UITouch[] {
    return Array.from(this.touches).filter((t) => t.view === view);
  }

  touchesForGestureRecognizer(recognizer: UIGestureRecognizer): UITouch[] {
    return Array.from(this.touches).filter((t) => t.gestureRecognizers.includes(recognizer));
  }
}
