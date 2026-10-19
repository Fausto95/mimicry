import type { UIEvent, UITouch } from './ui-event';

/**
 * UIResponder: the responder chain (view → superview → … → view controller →
 * window → application) and the touch callbacks. Default implementations
 * forward to the next responder, as UIKit does.
 */
export abstract class UIResponder {
  abstract get next(): UIResponder | null;

  get canBecomeFirstResponder(): boolean {
    return false;
  }

  get canResignFirstResponder(): boolean {
    return true;
  }

  get isFirstResponder(): boolean {
    return firstResponder === this;
  }

  becomeFirstResponder(): boolean {
    if (!this.canBecomeFirstResponder) return false;
    if (firstResponder === this) return true;
    if (firstResponder && !firstResponder.resignFirstResponder()) return false;
    firstResponder = this;
    this.didBecomeFirstResponder();
    return true;
  }

  resignFirstResponder(): boolean {
    if (firstResponder !== this) return true;
    if (!this.canResignFirstResponder) return false;
    firstResponder = null;
    this.didResignFirstResponder();
    return true;
  }

  /** @internal hooks for subclasses (UITextField shows / hides its editor) */
  protected didBecomeFirstResponder(): void {}
  protected didResignFirstResponder(): void {}

  touchesBegan(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.next?.touchesBegan(touches, event);
  }

  touchesMoved(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.next?.touchesMoved(touches, event);
  }

  touchesEnded(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.next?.touchesEnded(touches, event);
  }

  touchesCancelled(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    this.next?.touchesCancelled(touches, event);
  }

  static get currentFirstResponder(): UIResponder | null {
    return firstResponder;
  }
}

let firstResponder: UIResponder | null = null;
