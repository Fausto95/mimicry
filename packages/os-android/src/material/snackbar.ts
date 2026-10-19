import type { Kernel } from '@mimicry/os-core';
import { R_ID_CONTENT } from '../app/activity';
import { ColorStateList } from '../content/color-state-list';
import { TextAppearance } from '../content/theme';
import { MaterialMotion } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { Gravity } from '../view/gravity';
import { LayoutParams, View } from '../view/view';
import { FrameLayout, FrameLayoutParams, LinearLayout, LinearLayoutParams, type ViewGroup } from '../view/view-group';
import { WindowInsetsType } from '../view/window-insets';
import type { CharSequence } from '../text/spanned';
import { TextView } from '../widget/text-view';
import { ButtonStyle, MaterialButton } from './button';
import { MaterialShapeDrawable } from './shape';
import { CoordinatorLayout, snackbarViews } from '../widget/coordinator-layout';

/**
 * com.google.android.material.snackbar.Snackbar, Material 3: a short
 * message (and optional action) at the bottom of the screen, above the
 * navigation bar inset. It slides up from below the screen (500 ms,
 * emphasized easing — the M3 theme's motionDurationLong2 and
 * motionEasingEmphasized), stays for LENGTH_SHORT (1.5 s), LENGTH_LONG
 * (2.75 s) or until dismissed, and slides back down. One snackbar shows at
 * a time; a new one dismisses the current one (DISMISS_EVENT_CONSECUTIVE).
 *
 * The container is inverseSurface with 4 dp corners at elevation 6 dp,
 * 8 dp from the screen edges; the message is BodyMedium in
 * inverseOnSurface and the action a text button in inversePrimary.
 * Swipe-to-dismiss (a CoordinatorLayout behavior) is not modeled.
 */
export interface SnackbarCallback {
  onShown?(snackbar: Snackbar): void;
  onDismissed?(snackbar: Snackbar, event: number): void;
}

interface Manager {
  current: Snackbar | null;
  next: Snackbar | null;
}

const managers = new WeakMap<Kernel, Manager>();

const managerOf = (kernel: Kernel): Manager => {
  let m = managers.get(kernel);
  if (!m) managers.set(kernel, (m = { current: null, next: null }));
  return m;
};

export class Snackbar {
  static readonly LENGTH_INDEFINITE = -2;
  static readonly LENGTH_SHORT = -1;
  static readonly LENGTH_LONG = 0;
  static readonly DISMISS_EVENT_SWIPE = 0;
  static readonly DISMISS_EVENT_ACTION = 1;
  static readonly DISMISS_EVENT_TIMEOUT = 2;
  static readonly DISMISS_EVENT_MANUAL = 3;
  static readonly DISMISS_EVENT_CONSECUTIVE = 4;
  static readonly ANIMATION_DURATION = MaterialMotion.duration.long2;
  static readonly SHORT_DURATION_MS = 1500;
  static readonly LONG_DURATION_MS = 2750;

  private readonly view: FrameLayout;
  private readonly message: TextView;
  private readonly action: MaterialButton;
  private duration: number;
  private readonly callbacks: SnackbarCallback[] = [];
  private shown = false;
  private dismissing = false;
  private timer: unknown = null;
  private anim: ValueAnimator | null = null;
  private anchor: View | null = null;

  private constructor(private readonly parent: ViewGroup, text: CharSequence, duration: number) {
    const context = parent.context;
    const theme = context.getTheme();
    this.duration = duration;
    this.view = new FrameLayout(context);
    snackbarViews.add(this.view);
    const shape = new MaterialShapeDrawable();
    shape.setCornerSize(4);
    shape.setFillColor(ColorStateList.valueOf(theme.getColor('colorSurfaceInverse')));
    this.view.setBackground(shape);
    this.view.setElevation(6);
    this.view.setClickable(true);
    const row = new LinearLayout(context);
    row.setGravity(Gravity.CENTER_VERTICAL);
    this.message = new TextView(context);
    this.message.setText(text);
    this.message.setTextAppearance(TextAppearance.BodyMedium);
    this.message.setTextColor(theme.getColor('colorOnSurfaceInverse'));
    this.message.setMaxLines(2);
    this.message.setPadding(16, 14, 16, 14);
    row.addView(this.message, -1, new LinearLayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
    this.action = new MaterialButton(context, ButtonStyle.TEXT);
    this.action.setTextColor(theme.getColor('colorPrimaryInverse'));
    this.action.setRippleColor(((theme.getColor('colorPrimaryInverse') & 0x00ffffff) | (26 << 24)) | 0);
    this.action.setVisibility(View.GONE);
    const actionLp = new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
    actionLp.setMargins(0, 0, 8, 0);
    row.addView(this.action, -1, actionLp);
    this.view.addView(row, -1, new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
    this.view.setMinimumHeight(48);
  }

  /** Snackbar.make: attach to the nearest CoordinatorLayout or the activity's content frame above `view`. */
  static make(view: View, text: CharSequence, duration: number): Snackbar {
    const parent = Snackbar.findSuitableParent(view);
    if (!parent) throw new Error('IllegalArgumentException: No suitable parent found from the given view. Please provide a valid view.');
    return new Snackbar(parent, text, duration);
  }

  private static findSuitableParent(view: View): ViewGroup | null {
    let fallback: ViewGroup | null = null;
    for (let v: View | null = view; v; v = v.getParent()) {
      if (v instanceof CoordinatorLayout) return v;
      if (v instanceof FrameLayout) {
        if (v.getId() === R_ID_CONTENT) return v;
        fallback = v;
      }
    }
    return fallback;
  }

  getView(): View {
    return this.view;
  }

  getContext() {
    return this.parent.context;
  }

  setText(text: CharSequence): this {
    this.message.setText(text);
    return this;
  }

  setDuration(duration: number): this {
    this.duration = duration;
    return this;
  }

  getDuration(): number {
    return this.duration;
  }

  /** An action button; tapping it calls `listener` and dismisses (DISMISS_EVENT_ACTION). */
  setAction(text: CharSequence | null, listener: ((view: View) => void) | null): this {
    if (!text || !listener) {
      this.action.setVisibility(View.GONE);
      this.action.setOnClickListener(null);
      this.message.setPadding(16, 14, 16, 14);
      return this;
    }
    this.action.setText(text);
    this.action.setVisibility(View.VISIBLE);
    this.message.setPadding(16, 14, 8, 14);
    this.action.setOnClickListener((v) => {
      listener(v);
      this.dispatchDismiss(Snackbar.DISMISS_EVENT_ACTION);
    });
    return this;
  }

  setActionTextColor(color: number): this {
    this.action.setTextColor(color);
    return this;
  }

  setTextColor(color: number): this {
    this.message.setTextColor(color);
    return this;
  }

  setBackgroundTint(color: number): this {
    (this.view.getBackground() as MaterialShapeDrawable).setFillColor(ColorStateList.valueOf(color));
    return this;
  }

  setTextMaxLines(maxLines: number): this {
    this.message.setMaxLines(maxLines);
    return this;
  }

  /** Show above `anchor` instead of at the bottom edge. */
  setAnchorView(anchor: View | null): this {
    this.anchor = anchor;
    return this;
  }

  addCallback(callback: SnackbarCallback): this {
    this.callbacks.push(callback);
    return this;
  }

  removeCallback(callback: SnackbarCallback): this {
    const at = this.callbacks.indexOf(callback);
    if (at >= 0) this.callbacks.splice(at, 1);
    return this;
  }

  isShown(): boolean {
    return this.shown;
  }

  isShownOrQueued(): boolean {
    const m = managerOf(this.parent.context.kernel);
    return m.current === this || m.next === this;
  }

  private get kernel(): Kernel {
    return this.parent.context.kernel;
  }

  show(): void {
    const m = managerOf(this.kernel);
    if (m.current === this) {
      this.restartTimeout();
      return;
    }
    if (m.current) {
      m.next = this;
      m.current.dispatchDismiss(Snackbar.DISMISS_EVENT_CONSECUTIVE);
      return;
    }
    m.current = this;
    this.present();
  }

  dismiss(): void {
    this.dispatchDismiss(Snackbar.DISMISS_EVENT_MANUAL);
  }

  private present(): void {
    // The navigation bar inset only matters when the parent reaches the bottom of the window.
    const insets = this.parent.getRootWindowInsets();
    const [, parentTop] = this.parent.getLocationInWindow();
    const windowHeight = this.parent.getRootView().getHeight();
    const reachesBottom = parentTop + this.parent.getHeight() >= windowHeight - 1;
    const bottomInset = insets && reachesBottom ? insets.getInsets(WindowInsetsType.navigationBars()).bottom : 0;
    const lp = new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    let bottom = 8 + bottomInset;
    if (this.anchor && this.anchor.isAttachedToWindow()) {
      const [, anchorTop] = this.anchor.getLocationInWindow();
      const [, parentTop] = this.parent.getLocationInWindow();
      bottom = Math.max(8, this.parent.getHeight() - (anchorTop - parentTop) + 8);
    }
    lp.setMargins(8, 8, 8, bottom);
    this.parent.addView(this.view, -1, lp);
    // Slide in once laid out (as MDC waits for layout): from just below the screen.
    this.view.setAlpha(0);
    const start = () => {
      this.view.removeOnLayoutChangeListener(start);
      const distance = this.view.getHeight() + bottom;
      this.view.setTranslationY(distance);
      this.view.setAlpha(1);
      this.animate(distance, 0, () => {
        this.shown = true;
        for (const c of this.callbacks.slice()) c.onShown?.(this);
        this.restartTimeout();
      });
    };
    this.view.addOnLayoutChangeListener(start);
  }

  private restartTimeout(): void {
    if (this.timer != null) this.kernel.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.duration === Snackbar.LENGTH_INDEFINITE) return;
    const ms = this.duration === Snackbar.LENGTH_SHORT ? Snackbar.SHORT_DURATION_MS : this.duration === Snackbar.LENGTH_LONG ? Snackbar.LONG_DURATION_MS : this.duration;
    this.timer = this.kernel.clock.setTimeout(() => {
      this.timer = null;
      this.dispatchDismiss(Snackbar.DISMISS_EVENT_TIMEOUT);
      this.kernel.requestFrame();
    }, ms);
  }

  private dispatchDismiss(event: number): void {
    const m = managerOf(this.kernel);
    if (m.next === this && m.current !== this) {
      m.next = null;
      return;
    }
    if (this.dismissing || m.current !== this) return;
    this.dismissing = true;
    if (this.timer != null) this.kernel.clock.clearTimeout(this.timer);
    this.timer = null;
    const finish = () => {
      this.parent.removeView(this.view);
      this.shown = false;
      this.dismissing = false;
      for (const c of this.callbacks.slice()) c.onDismissed?.(this, event);
      m.current = null;
      const next = m.next;
      m.next = null;
      if (next) {
        m.current = next;
        next.present();
      }
    };
    if (!this.view.isAttachedToWindow() || !this.view.isLaidOut()) {
      this.anim?.cancel();
      finish();
      return;
    }
    const lp = this.view.getLayoutParams() as FrameLayoutParams | null;
    this.animate(this.view.getTranslationY(), this.view.getHeight() + (lp?.bottomMargin ?? 0), finish);
  }

  private animate(from: number, to: number, end: () => void): void {
    this.anim?.cancel();
    const anim = ValueAnimator.ofFloat(from, to);
    anim.setKernel(this.kernel);
    anim.setDuration(Snackbar.ANIMATION_DURATION);
    anim.setInterpolator(MaterialMotion.easing.emphasized);
    anim.addUpdateListener((a) => this.view.setTranslationY(a.getAnimatedValue() as number));
    let canceled = false;
    anim.addListener({ onAnimationCancel: () => (canceled = true), onAnimationEnd: () => !canceled && end() });
    this.anim = anim;
    anim.start();
  }
}
