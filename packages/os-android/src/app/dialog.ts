import type { Context } from '../content/context';
import { Color } from '../graphics/color';
import type { Canvas } from '../graphics/canvas';
import { MaterialMotion } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { Gravity } from '../view/gravity';
import { MotionEvent } from '../view/motion-event';
import { LayoutParams, View } from '../view/view';
import { FrameLayout, FrameLayoutParams } from '../view/view-group';
import { WindowInsetsType } from '../view/window-insets';
import { WindowFlags, WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';

/**
 * android.app.Dialog: content in its own window above the activity
 * (TYPE_APPLICATION_ATTACHED_DIALOG). FLAG_DIM_BEHIND draws a scrim of
 * dimAmount (0.32, the Material 3 theme's backgroundDimAmount) behind it.
 * show() runs onCreate once, onStart, then the enter animation (fade and
 * scale from 0.9, 250 ms, emphasized decelerate); dismiss() fades it out
 * (150 ms) and removes the window. Back cancels a cancelable dialog, and so
 * does a tap outside it when setCanceledOnTouchOutside allows.
 */
export interface DialogInterface {
  cancel(): void;
  dismiss(): void;
}

export const DialogInterfaceButtons = {
  BUTTON_POSITIVE: -1,
  BUTTON_NEGATIVE: -2,
  BUTTON_NEUTRAL: -3,
} as const;

export type DialogClickListener = (dialog: DialogInterface, which: number) => void;
export type DialogMultiChoiceListener = (dialog: DialogInterface, which: number, isChecked: boolean) => void;

const ENTER = 250;
const EXIT = 150;

/** The dialog's window root: the scrim and the dialog panel. */
class DialogRoot extends FrameLayout {
  dim = 0.32;
  dimEnabled = true;
  scrimAlpha = 0;

  constructor(context: Context, private readonly onOutsideTouch: () => void, private readonly panel: () => View | null) {
    super(context);
    this.setClickable(true);
  }

  protected override onDraw(canvas: Canvas): void {
    if (!this.dimEnabled || this.dim <= 0) return;
    const a = Math.round(255 * this.dim * this.scrimAlpha);
    canvas.writer.fillRect(0, 0, this.getWidth(), this.getHeight(), Color.toRgba(Color.argb(a, 0, 0, 0)));
  }

  private downOutside = false;

  override onTouchEvent(event: MotionEvent): boolean {
    // inside the dialog's content (the decor's child, or the decor itself)
    const decor = this.panel();
    const content = decor instanceof FrameLayout && decor.getChildCount() === 1 ? decor.getChildAt(0)! : decor;
    const ox = content && content !== decor && decor ? decor.getLeft() : 0;
    const oy = content && content !== decor && decor ? decor.getTop() : 0;
    const x = event.getX() - ox;
    const y = event.getY() - oy;
    const inside = !!content && x >= content.getLeft() && x < content.getRight() && y >= content.getTop() && y < content.getBottom();
    if (event.getActionMasked() === MotionEvent.ACTION_DOWN) this.downOutside = !inside;
    if (event.getActionMasked() === MotionEvent.ACTION_UP && this.downOutside && !inside) this.onOutsideTouch();
    return true;
  }
}

/** android.view.Window for a dialog: layout, gravity, dim and the decor view. */
export class DialogWindow {
  private width = LayoutParams.WRAP_CONTENT;
  private height = LayoutParams.WRAP_CONTENT;
  private gravity: number = Gravity.CENTER;
  private flags: number = WindowFlags.FLAG_DIM_BEHIND;

  constructor(private readonly root: DialogRoot, private readonly decor: FrameLayout) {}

  getDecorView(): FrameLayout {
    return this.decor;
  }

  /** The panel's size (dp, MATCH_PARENT or WRAP_CONTENT). */
  setLayout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.apply();
  }

  setGravity(gravity: number): void {
    this.gravity = gravity;
    this.apply();
  }

  setDimAmount(amount: number): void {
    this.root.dim = Math.max(0, Math.min(1, amount));
    this.root.invalidate();
  }

  getDimAmount(): number {
    return this.root.dim;
  }

  addFlags(flags: number): void {
    this.setFlags(this.flags | flags);
  }

  clearFlags(flags: number): void {
    this.setFlags(this.flags & ~flags);
  }

  setFlags(flags: number): void {
    this.flags = flags;
    this.root.dimEnabled = (flags & WindowFlags.FLAG_DIM_BEHIND) !== 0;
    this.root.invalidate();
  }

  getFlags(): number {
    return this.flags;
  }

  setBackgroundDrawableColor(color: number): void {
    this.decor.setBackgroundColor(color);
  }

  /** @internal */
  apply(): void {
    const lp = new FrameLayoutParams(this.width, this.height, this.gravity);
    this.decor.setLayoutParams(lp);
  }
}

export class Dialog implements DialogInterface {
  private readonly root: DialogRoot;
  protected readonly decor: FrameLayout;
  private readonly window: DialogWindow;
  private created = false;
  private showing = false;
  private dismissing = false;
  private cancelable = true;
  private canceledOnTouchOutside = true;
  private onShow: ((dialog: DialogInterface) => void) | null = null;
  private onDismiss: ((dialog: DialogInterface) => void) | null = null;
  private onCancel: ((dialog: DialogInterface) => void) | null = null;
  private anim: ValueAnimator | null = null;
  private title: string | null = null;

  constructor(readonly context: Context) {
    this.decor = new FrameLayout(context);
    this.root = new DialogRoot(context, () => {
      if (this.cancelable && this.canceledOnTouchOutside) this.cancel();
    }, () => this.decor);
    this.root.addView(this.decor, -1, new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    this.root.setOnApplyWindowInsetsListener((v, insets) => {
      // keep the dialog clear of the system bars
      const bars = insets.getInsets(WindowInsetsType.systemBars() | WindowInsetsType.displayCutout());
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return insets;
    });
    this.window = new DialogWindow(this.root, this.decor);
  }

  getContext(): Context {
    return this.context;
  }

  getWindow(): DialogWindow {
    return this.window;
  }

  /** Called once, before the dialog first shows (build the content here). */
  protected onCreate(_savedInstanceState: unknown): void {}
  protected onStart(): void {}
  protected onStop(): void {}

  setContentView(view: View, params?: LayoutParams): void {
    this.decor.removeAllViews();
    this.decor.addView(view, -1, params ?? new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
  }

  findViewById<T extends View = View>(id: number): T | null {
    return this.decor.findViewById<T>(id);
  }

  setTitle(title: string | null): void {
    this.title = title;
  }

  getTitle(): string | null {
    return this.title;
  }

  setCancelable(cancelable: boolean): void {
    this.cancelable = cancelable;
  }

  isCancelable(): boolean {
    return this.cancelable;
  }

  setCanceledOnTouchOutside(cancel: boolean): void {
    if (cancel && !this.cancelable) this.cancelable = true;
    this.canceledOnTouchOutside = cancel;
  }

  setOnShowListener(listener: ((dialog: DialogInterface) => void) | null): void {
    this.onShow = listener;
  }

  setOnDismissListener(listener: ((dialog: DialogInterface) => void) | null): void {
    this.onDismiss = listener;
  }

  setOnCancelListener(listener: ((dialog: DialogInterface) => void) | null): void {
    this.onCancel = listener;
  }

  isShowing(): boolean {
    return this.showing;
  }

  private windowManager(): WindowManager {
    const wm = this.context.getSystemService<WindowManager>('window');
    if (!wm) throw new Error('WindowManager.BadTokenException: Unable to add window -- no window manager (Android has not booted)');
    return wm;
  }

  /** @internal the window's root view (tests, framework adapters) */
  get windowRoot(): View {
    return this.root;
  }

  /** @internal create the content without showing (AlertDialog.create) */
  ensureCreated(): void {
    if (this.created) return;
    this.created = true;
    this.onCreate(null);
  }

  show(): void {
    if (this.showing && !this.dismissing) return;
    this.ensureCreated();
    this.anim?.cancel();
    this.dismissing = false;
    if (!this.root.isAttachedToWindow()) {
      this.onStart();
      this.windowManager().addView(this.root, new WindowLayoutParams(WindowType.TYPE_APPLICATION_ATTACHED_DIALOG, this.window.getFlags() & ~WindowFlags.FLAG_NOT_TOUCH_MODAL), () => {
        if (this.cancelable) this.cancel();
        return true;
      });
      this.root.scrimAlpha = 0;
      this.decor.setAlpha(0);
      this.decor.setScaleX(0.9);
      this.decor.setScaleY(0.9);
    }
    this.showing = true;
    this.animate(1, ENTER, MaterialMotion.easing.emphasizedDecelerate, () => this.onShow?.(this));
  }

  dismiss(): void {
    if (!this.showing || this.dismissing) return;
    this.dismissing = true;
    this.animate(0, EXIT, MaterialMotion.easing.emphasizedAccelerate, () => {
      this.dismissing = false;
      this.showing = false;
      this.windowManager().removeView(this.root);
      this.onStop();
      this.onDismiss?.(this);
    });
  }

  cancel(): void {
    if (!this.showing || this.dismissing) return;
    this.onCancel?.(this);
    this.dismiss();
  }

  /** Hide without dismissing (the window stays). */
  hide(): void {
    this.root.setVisibility(View.INVISIBLE);
  }

  private animate(to: number, duration: number, interpolator: { getInterpolation(t: number): number }, end: () => void): void {
    this.anim?.cancel();
    const from = this.root.scrimAlpha;
    const anim = ValueAnimator.ofFloat(from, to);
    anim.setKernel(this.context.kernel);
    anim.setDuration(duration);
    anim.setInterpolator(interpolator);
    anim.addUpdateListener((a) => {
      const f = a.getAnimatedValue() as number;
      this.root.scrimAlpha = f;
      this.root.invalidate();
      this.decor.setAlpha(f);
      const scale = 0.9 + 0.1 * f;
      this.decor.setScaleX(scale);
      this.decor.setScaleY(scale);
    });
    let canceled = false;
    anim.addListener({ onAnimationCancel: () => (canceled = true), onAnimationEnd: () => !canceled && end() });
    this.anim = anim;
    anim.start();
  }
}
