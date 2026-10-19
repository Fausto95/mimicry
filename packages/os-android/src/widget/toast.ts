import type { Kernel } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { TextAppearance } from '../content/theme';
import { ColorStateList } from '../content/color-state-list';
import { LinearOutSlowInInterpolator, FastOutLinearInInterpolator } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { Gravity } from '../view/gravity';
import { LayoutParams, View } from '../view/view';
import { FrameLayout, FrameLayoutParams } from '../view/view-group';
import { WindowFlags, WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';
import { MaterialShapeDrawable } from '../material/shape';
import type { CharSequence } from '../text/spanned';
import { TextView } from './text-view';

/**
 * android.widget.Toast: a short message in a non-touchable TYPE_TOAST
 * window above everything. As in NotificationManagerService, toasts queue
 * and show one at a time, LENGTH_SHORT for 2 s and LENGTH_LONG for 3.5 s,
 * fading in and out. The look is Android 12+'s text toast: a rounded
 * surface near the bottom of the screen with up to two lines of text (the
 * app icon SystemUI adds next to it is not drawn).
 */
export interface ToastCallback {
  onToastShown?(): void;
  onToastHidden?(): void;
}

interface ToastQueue {
  queue: Toast[];
  current: Toast | null;
}

const queues = new WeakMap<Kernel, ToastQueue>();
const FADE_IN = 250;
const FADE_OUT = 250;

export class Toast {
  static readonly LENGTH_SHORT = 0;
  static readonly LENGTH_LONG = 1;
  static readonly SHORT_DURATION = 2000;
  static readonly LONG_DURATION = 3500;

  private text: CharSequence = '';
  private duration = Toast.LENGTH_SHORT;
  private gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
  private xOffset = 0;
  private yOffset = 64;
  private customView: View | null = null;
  private readonly callbacks: ToastCallback[] = [];
  private window: FrameLayout | null = null;
  private hideTimer: unknown = null;
  private fade: ValueAnimator | null = null;

  constructor(private readonly context: Context) {}

  static makeText(context: Context, text: CharSequence, duration: number): Toast {
    const toast = new Toast(context);
    toast.text = text;
    toast.duration = duration;
    return toast;
  }

  setText(text: CharSequence): void {
    this.text = text;
  }

  setDuration(duration: number): void {
    this.duration = duration;
  }

  getDuration(): number {
    return this.duration;
  }

  /** Deprecated for text toasts on Android 11+, honored here. */
  setGravity(gravity: number, xOffset: number, yOffset: number): void {
    this.gravity = gravity;
    this.xOffset = xOffset;
    this.yOffset = yOffset;
  }

  getGravity(): number {
    return this.gravity;
  }

  /** A custom toast view (deprecated in the framework). */
  setView(view: View | null): void {
    this.customView = view;
  }

  getView(): View | null {
    return this.customView;
  }

  addCallback(callback: ToastCallback): void {
    this.callbacks.push(callback);
  }

  removeCallback(callback: ToastCallback): void {
    const at = this.callbacks.indexOf(callback);
    if (at >= 0) this.callbacks.splice(at, 1);
  }

  private get kernel(): Kernel {
    return this.context.kernel;
  }

  private static queueOf(kernel: Kernel): ToastQueue {
    let q = queues.get(kernel);
    if (!q) queues.set(kernel, (q = { queue: [], current: null }));
    return q;
  }

  /** Queue the toast; it shows once the toasts before it are gone. */
  show(): void {
    const q = Toast.queueOf(this.kernel);
    if (q.current === this || q.queue.includes(this)) return;
    q.queue.push(this);
    if (!q.current) Toast.showNext(this.kernel);
  }

  /** Hide it now (or drop it from the queue). */
  cancel(): void {
    const q = Toast.queueOf(this.kernel);
    const at = q.queue.indexOf(this);
    if (at >= 0) q.queue.splice(at, 1);
    if (q.current === this) this.hide();
  }

  /** @internal the toast currently on screen (tests) */
  static current(kernel: Kernel): Toast | null {
    return queues.get(kernel)?.current ?? null;
  }

  private static showNext(kernel: Kernel): void {
    const q = Toast.queueOf(kernel);
    const next = q.queue.shift();
    q.current = next ?? null;
    next?.present();
  }

  private buildView(): View {
    if (this.customView) return this.customView;
    const context = this.context;
    const theme = context.getTheme();
    const label = new TextView(context);
    label.setText(this.text);
    label.setTextAppearance(TextAppearance.BodyMedium);
    label.setTextColor(theme.getColor('colorOnSurface'));
    label.setMaxLines(2);
    label.setPadding(16, 12, 16, 12);
    label.setMaxWidth(300);
    const bg = new MaterialShapeDrawable();
    bg.setCornerSize(24);
    bg.setFillColor(ColorStateList.valueOf(theme.getColor('colorSurfaceContainer')));
    label.setBackground(bg);
    label.setElevation(2);
    return label;
  }

  private present(): void {
    const wm = this.context.getSystemService<WindowManager>('window');
    if (!wm) throw new Error('Toast: no window manager (Android has not booted on this kernel)');
    const root = new FrameLayout(this.context);
    const view = this.buildView();
    const lp = new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, this.gravity);
    const vertical = this.gravity & Gravity.VERTICAL_GRAVITY_MASK;
    lp.setMargins(this.xOffset, vertical === Gravity.TOP ? this.yOffset : 0, 0, vertical === Gravity.BOTTOM ? this.yOffset : 0);
    root.addView(view, -1, lp);
    root.setAlpha(0);
    this.window = root;
    wm.addView(root, new WindowLayoutParams(WindowType.TYPE_TOAST, WindowFlags.FLAG_NOT_TOUCHABLE | WindowFlags.FLAG_NOT_FOCUSABLE));
    for (const c of this.callbacks.slice()) c.onToastShown?.();
    this.animateAlpha(1, FADE_IN, new LinearOutSlowInInterpolator(), () => {});
    const visible = this.duration === Toast.LENGTH_LONG ? Toast.LONG_DURATION : Toast.SHORT_DURATION;
    this.hideTimer = this.kernel.clock.setTimeout(() => {
      this.hideTimer = null;
      this.hide();
      this.kernel.requestFrame();
    }, visible);
  }

  private hide(): void {
    if (this.hideTimer != null) this.kernel.clock.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const root = this.window;
    if (!root) return;
    this.animateAlpha(0, FADE_OUT, new FastOutLinearInInterpolator(), () => this.removeWindow());
  }

  private removeWindow(): void {
    const root = this.window;
    if (!root) return;
    this.window = null;
    this.context.getSystemService<WindowManager>('window')?.removeView(root);
    for (const c of this.callbacks.slice()) c.onToastHidden?.();
    const q = Toast.queueOf(this.kernel);
    if (q.current === this) Toast.showNext(this.kernel);
  }

  private animateAlpha(to: number, duration: number, interpolator: LinearOutSlowInInterpolator | FastOutLinearInInterpolator, end: () => void): void {
    const root = this.window;
    if (!root) return;
    this.fade?.cancel();
    const from = root.getAlpha();
    const anim = ValueAnimator.ofFloat(from, to);
    anim.setKernel(this.kernel);
    anim.setDuration(duration);
    anim.setInterpolator(interpolator);
    anim.addUpdateListener((a) => root.setAlpha(a.getAnimatedValue() as number));
    let canceled = false;
    anim.addListener({ onAnimationCancel: () => (canceled = true), onAnimationEnd: () => !canceled && end() });
    this.fade = anim;
    anim.start();
  }
}
