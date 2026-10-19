import type { CGPoint } from '../core-graphics/geometry';
import type { UIEvent, UITouch } from './ui-event';
import { UIView } from './ui-view';

/**
 * UIControl: target-action for control events and touch tracking
 * (begin / continue / end / cancel), with UIKit's 70 pt "touch inside" slop
 * once a touch has started inside.
 */
export enum UIControlEvents {
  touchDown = 1 << 0,
  touchDownRepeat = 1 << 1,
  touchDragInside = 1 << 2,
  touchDragOutside = 1 << 3,
  touchDragEnter = 1 << 4,
  touchDragExit = 1 << 5,
  touchUpInside = 1 << 6,
  touchUpOutside = 1 << 7,
  touchCancel = 1 << 8,
  valueChanged = 1 << 12,
  primaryActionTriggered = 1 << 13,
  editingDidBegin = 1 << 16,
  editingChanged = 1 << 17,
  editingDidEnd = 1 << 18,
  editingDidEndOnExit = 1 << 19,
}

export enum UIControlState { normal = 0, highlighted = 1, disabled = 2, selected = 4, focused = 8 }

type ControlAction = (sender: UIControl, event: UIEvent | null) => void;

export class UIControl extends UIView {
  private readonly targets: Array<{ events: number; action: ControlAction }> = [];
  private _isEnabled = true;
  private _isHighlighted = false;
  isSelected = false;
  private _isTracking = false;
  private _isTouchInside = false;
  /** how far outside the bounds a tracked touch still counts as inside */
  protected touchInsideSlop = 70;

  addTarget(action: ControlAction, events: UIControlEvents | number): void {
    this.targets.push({ events, action });
  }

  removeTarget(action: ControlAction, events?: UIControlEvents | number): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i]!;
      if (t.action === action && (events === undefined || (t.events & events) !== 0)) this.targets.splice(i, 1);
    }
  }

  sendActions(events: UIControlEvents | number, event: UIEvent | null = null): void {
    for (const t of this.targets.slice()) if ((t.events & events) !== 0) t.action(this, event);
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  set isEnabled(enabled: boolean) {
    this._isEnabled = enabled;
    this.setNeedsDisplay();
  }

  get isHighlighted(): boolean {
    return this._isHighlighted;
  }

  set isHighlighted(h: boolean) {
    if (this._isHighlighted === h) return;
    this._isHighlighted = h;
    this.highlightChanged(h);
    this.setNeedsDisplay();
  }

  /** Subclasses animate press feedback. */
  protected highlightChanged(_highlighted: boolean): void {}

  get state(): number {
    return (this._isHighlighted ? UIControlState.highlighted : 0) | (!this._isEnabled ? UIControlState.disabled : 0) | (this.isSelected ? UIControlState.selected : 0);
  }

  get isTracking(): boolean {
    return this._isTracking;
  }

  get isTouchInside(): boolean {
    return this._isTouchInside;
  }

  // ── tracking (override points) ──────────────────────────────────────

  beginTracking(_touch: UITouch, _event: UIEvent): boolean {
    return true;
  }

  continueTracking(_touch: UITouch, _event: UIEvent): boolean {
    return true;
  }

  endTracking(_touch: UITouch | null, _event: UIEvent | null): void {}

  cancelTracking(_event: UIEvent | null): void {}

  private inside(p: CGPoint): boolean {
    const b = this.bounds.size;
    const s = this.touchInsideSlop;
    return p.x >= -s && p.y >= -s && p.x <= b.width + s && p.y <= b.height + s;
  }

  override touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    const touch = touches.values().next().value as UITouch;
    if (!this._isEnabled) return;
    this._isTracking = this.beginTracking(touch, event);
    this._isTouchInside = true;
    this.isHighlighted = true;
    this.sendActions(UIControlEvents.touchDown, event);
  }

  override touchesMoved(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (!this._isEnabled) return;
    const touch = touches.values().next().value as UITouch;
    const inside = this.inside(touch.location(this));
    const was = this._isTouchInside;
    this._isTouchInside = inside;
    this.isHighlighted = inside;
    if (was !== inside) this.sendActions(inside ? UIControlEvents.touchDragEnter : UIControlEvents.touchDragExit, event);
    this.sendActions(inside ? UIControlEvents.touchDragInside : UIControlEvents.touchDragOutside, event);
    if (this._isTracking) this._isTracking = this.continueTracking(touch, event);
  }

  override touchesEnded(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    if (!this._isEnabled) return;
    const touch = touches.values().next().value as UITouch;
    const inside = this.inside(touch.location(this));
    this._isTouchInside = inside;
    this.isHighlighted = false;
    if (this._isTracking) this.endTracking(touch, event);
    this._isTracking = false;
    this.sendActions(inside ? UIControlEvents.touchUpInside : UIControlEvents.touchUpOutside, event);
    if (inside) this.sendActions(UIControlEvents.primaryActionTriggered, event);
  }

  override touchesCancelled(_touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.isHighlighted = false;
    if (this._isTracking) this.cancelTracking(event);
    this._isTracking = false;
    this.sendActions(UIControlEvents.touchCancel, event);
  }
}
