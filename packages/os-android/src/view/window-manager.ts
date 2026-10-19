import type { Kernel } from '@mimicry/os-core';
import type { View } from './view';
import { ViewRootImpl } from './view-root';
import { Insets, WindowInsets } from './window-insets';

/**
 * android.view.WindowManager: windows (each a view tree with its own
 * ViewRootImpl) stacked by type — application windows, then sub-windows
 * (dialogs), then the system UI. Routes touches to the topmost window that
 * takes them, runs every window's traversal on the layout pass, and hands
 * hardware back to the focused window.
 */
export const WindowType = {
  TYPE_BASE_APPLICATION: 1,
  TYPE_APPLICATION: 2,
  TYPE_APPLICATION_PANEL: 1000,
  TYPE_APPLICATION_ATTACHED_DIALOG: 1003,
  TYPE_TOAST: 2005,
  TYPE_STATUS_BAR: 2000,
  TYPE_NAVIGATION_BAR: 2019,
  TYPE_SYSTEM_ALERT: 2003,
} as const;

export const WindowFlags = {
  FLAG_NOT_FOCUSABLE: 0x8,
  FLAG_NOT_TOUCHABLE: 0x10,
  FLAG_NOT_TOUCH_MODAL: 0x20,
  FLAG_DIM_BEHIND: 0x2,
  FLAG_LAYOUT_NO_LIMITS: 0x200,
} as const;

export class WindowLayoutParams {
  width = -1;
  height = -1;
  x = 0;
  y = 0;
  dimAmount = 0;
  constructor(public type: number = WindowType.TYPE_APPLICATION, public flags = 0) {}
}

export interface WindowRecord {
  view: View;
  params: WindowLayoutParams;
  root: ViewRootImpl;
  /** back handling for this window (Dialog, Activity) */
  onBack?: () => boolean;
}

export class WindowManager {
  readonly windows: WindowRecord[] = [];
  private readonly touchWindow = new Map<number, WindowRecord>();

  constructor(readonly kernel: Kernel, options: { routeInput?: boolean } = {}) {
    kernel.addLayoutPass(() => {
      for (const w of this.windows.slice()) w.root.performTraversals();
    });
    if (options.routeInput !== false) {
      kernel.on('pointer', (m) => {
        this.pointer(m.phase, m.id, m.x, m.y, m.time);
        kernel.requestFrame();
      });
    }
    kernel.env.subscribe(() => {
      for (const w of this.windows) {
        w.root.frame = this.frameFor(w.params);
        w.root.setInsets(this.currentInsets());
        w.view.requestLayout();
      }
    });
  }

  /** The system bars' insets for the current device and orientation. */
  currentInsets(): WindowInsets {
    const v = this.kernel.viewport;
    return WindowInsets.fromBars(v.safeArea.top, v.safeArea.bottom, v.safeArea.left, v.safeArea.right, Insets.of(v.safeArea.left, v.safeArea.top, v.safeArea.right, 0));
  }

  private frameFor(params: WindowLayoutParams) {
    const v = this.kernel.viewport;
    const w = params.width < 0 ? v.width : params.width;
    const h = params.height < 0 ? v.height : params.height;
    return { x: params.x, y: params.y, w, h };
  }

  addView(view: View, params: WindowLayoutParams = new WindowLayoutParams(), onBack?: () => boolean): WindowRecord {
    const root = new ViewRootImpl(this.kernel, view, this.frameFor(params), this.currentInsets());
    view.renderNode.x = params.x;
    view.renderNode.y = params.y;
    const record: WindowRecord = { view, params, root, onBack };
    this.windows.push(record);
    this.windows.sort((a, b) => a.params.type - b.params.type);
    this.kernel.display.addWindow(view.renderNode, params.type);
    this.kernel.setNeedsLayout();
    return record;
  }

  removeView(view: View): void {
    const at = this.windows.findIndex((w) => w.view === view);
    if (at < 0) return;
    const [record] = this.windows.splice(at, 1);
    for (const [id, w] of this.touchWindow) if (w === record) this.touchWindow.delete(id);
    record!.root.detach();
    this.kernel.display.removeWindow(view.renderNode);
    this.kernel.setNeedsDisplay();
  }

  updateViewLayout(view: View, params: WindowLayoutParams): void {
    const record = this.windows.find((w) => w.view === view);
    if (!record) return;
    record.params = params;
    record.root.frame = this.frameFor(params);
    view.requestLayout();
  }

  /** Topmost first. */
  private windowsTopDown(): WindowRecord[] {
    return this.windows.slice().reverse();
  }

  private pointer(phase: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, time: number): void {
    this.kernel.layoutIfNeeded();
    if (phase === 'down') {
      if (this.touchWindow.has(id)) return;
      // A second finger goes to the window the gesture started in.
      const existing = this.touchWindow.values().next().value as WindowRecord | undefined;
      const target = existing ?? this.windowsTopDown().find((w) => this.takesTouch(w, x, y));
      if (!target) return;
      this.touchWindow.set(id, target);
      target.root.dispatchPointer(phase, id, x, y, time);
      return;
    }
    const target = this.touchWindow.get(id);
    if (!target) return;
    if (phase === 'up' || phase === 'cancel') this.touchWindow.delete(id);
    target.root.dispatchPointer(phase, id, x, y, time);
  }

  private takesTouch(w: WindowRecord, x: number, y: number): boolean {
    const p = w.params;
    if (p.flags & WindowFlags.FLAG_NOT_TOUCHABLE) return false;
    const f = w.root.frame;
    const inside = x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h;
    // Without FLAG_NOT_TOUCH_MODAL a window takes every touch (dialogs).
    return inside || !(p.flags & WindowFlags.FLAG_NOT_TOUCH_MODAL);
  }

  /** Hardware back: the topmost window that handles it. */
  back(): boolean {
    for (const w of this.windowsTopDown()) {
      if (w.onBack?.()) return true;
    }
    return false;
  }
}
