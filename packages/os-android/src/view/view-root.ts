import type { Kernel } from '@mimicry/os-core';
import { MotionEvent } from './motion-event';
import { MeasureSpec, View } from './view';
import { dispatchAttach, dispatchDetach } from './view-group';
import { WindowInsets } from './window-insets';

/**
 * android.view.ViewRootImpl: the bridge between a window's view tree and the
 * system — traversals (measure, layout) before frames, window insets, and
 * input: digitizer samples become MotionEvents for the root view.
 */
export class ViewRootImpl {
  private traversalScheduled = false;
  private insetsRequested = true;
  private _insets: WindowInsets;
  /** pointers currently down, in down order: id → window position */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private downTime = 0;
  /** the view in this window that has focus */
  focusedView: View | null = null;

  constructor(
    readonly kernel: Kernel,
    readonly view: View,
    /** window frame in screen coordinates */
    public frame: { x: number; y: number; w: number; h: number },
    insets: WindowInsets,
  ) {
    this._insets = insets;
    view.renderNode.host = kernel;
    dispatchAttach(view, this);
    this.scheduleTraversals();
  }

  get windowInsets(): WindowInsets {
    return this._insets;
  }

  setInsets(insets: WindowInsets): void {
    this._insets = insets;
    this.requestApplyInsets();
  }

  requestApplyInsets(): void {
    this.insetsRequested = true;
    this.scheduleTraversals();
  }

  scheduleTraversals(): void {
    if (this.traversalScheduled) return;
    this.traversalScheduled = true;
    this.kernel.setNeedsLayout();
  }

  /** Measure and lay out the tree if anything asked for it. */
  performTraversals(): void {
    if (!this.traversalScheduled) return;
    this.traversalScheduled = false;
    if (this.insetsRequested) {
      this.insetsRequested = false;
      this.view.dispatchApplyWindowInsets(this._insets);
    }
    if (this.view.isLayoutRequested() || this.view.getWidth() !== this.frame.w || this.view.getHeight() !== this.frame.h) {
      this.view.measure(MeasureSpec.makeMeasureSpec(this.frame.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(this.frame.h, MeasureSpec.EXACTLY));
      this.view.layout(0, 0, this.frame.w, this.frame.h);
    }
  }

  /** Screen-space digitizer sample → MotionEvent through the root view. */
  dispatchPointer(phase: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, time: number): boolean {
    const lx = x - this.frame.x;
    const ly = y - this.frame.y;
    let action: number;
    if (phase === 'down') {
      if (this.pointers.has(id)) return false;
      if (!this.pointers.size) this.downTime = time;
      this.pointers.set(id, { x: lx, y: ly });
      const index = Array.from(this.pointers.keys()).indexOf(id);
      action = this.pointers.size === 1 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_POINTER_DOWN | (index << MotionEvent.ACTION_POINTER_INDEX_SHIFT);
    } else {
      if (!this.pointers.has(id)) return false;
      this.pointers.set(id, { x: lx, y: ly });
      const index = Array.from(this.pointers.keys()).indexOf(id);
      if (phase === 'move') action = MotionEvent.ACTION_MOVE;
      else if (phase === 'cancel') action = MotionEvent.ACTION_CANCEL;
      else action = this.pointers.size === 1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_POINTER_UP | (index << MotionEvent.ACTION_POINTER_INDEX_SHIFT);
    }
    const event = MotionEvent.obtain(this.downTime, time, action, Array.from(this.pointers, ([pid, p]) => ({ id: pid, x: p.x, y: p.y })));
    if (phase === 'up' || phase === 'cancel') this.pointers.delete(id);
    if (phase === 'cancel') this.pointers.clear();
    return this.view.dispatchTouchEvent(event);
  }

  get hasPointers(): boolean {
    return this.pointers.size > 0;
  }

  detach(): void {
    dispatchDetach(this.view);
    this.view.renderNode.host = null;
  }
}
