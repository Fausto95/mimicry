import type { Context } from '../content/context';
import { ArgbEvaluator, ValueAnimator } from '../animation/value-animator';
import { LinearLayout } from '../view/view-group';
import { WindowInsetsType, type WindowInsets } from '../view/window-insets';
import type { View } from '../view/view';
import { ScrollView } from '../widget/scroll-view';
import { RecyclerView } from '../widget/recycler-view';

/**
 * com.google.android.material.appbar.AppBarLayout, Material 3: a vertical
 * container for the top app bar that sits under the status bar in an
 * edge-to-edge window (it pads itself by the status bar inset) and "lifts"
 * when the content under it scrolls — its color goes from colorSurface to
 * surfaceContainer (liftOnScroll, on by default in M3).
 *
 * Collapsing layouts (CollapsingToolbarLayout's large and medium bars) are
 * not modeled.
 */
export class AppBarLayout extends LinearLayout {
  private liftOnScroll = true;
  private lifted = false;
  private target: View | null = null;
  private unwatch: (() => void) | null = null;
  private colorAnim: ValueAnimator | null = null;
  private color: number;
  private statusBarInset = true;

  constructor(context: Context) {
    super(context);
    this.setOrientation(LinearLayout.VERTICAL);
    this.color = context.getTheme().getColor('colorSurface');
    this.setBackgroundColor(this.color);
  }

  /** Mimicry: pad by the status bar inset (on by default for edge-to-edge windows). */
  setStatusBarInsetPadding(enabled: boolean): void {
    this.statusBarInset = enabled;
    this.requestApplyInsets();
  }

  override onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    if (!this.statusBarInset) return super.onApplyWindowInsets(insets);
    const top = insets.getInsets(WindowInsetsType.statusBars() | WindowInsetsType.displayCutout()).top;
    this.setPadding(this.getPaddingLeft(), top, this.getPaddingRight(), this.getPaddingBottom());
    return insets;
  }

  setLiftOnScroll(lift: boolean): void {
    this.liftOnScroll = lift;
    if (!lift) this.setLifted(false);
  }

  isLiftOnScroll(): boolean {
    return this.liftOnScroll;
  }

  /** The scrolling view whose offset lifts the bar (a ScrollView or RecyclerView). */
  setLiftOnScrollTargetView(view: View | null): void {
    this.unwatch?.();
    this.unwatch = null;
    this.target = view;
    if (view instanceof ScrollView) {
      this.unwatch = view.addScrollObserver((_v, _x, y) => this.onTargetScrolled(y > 0));
    } else if (view instanceof RecyclerView) {
      const listener = { onScrolled: (rv: RecyclerView) => this.onTargetScrolled(rv.computeVerticalScrollOffset() > 0) };
      view.addOnScrollListener(listener);
      this.unwatch = () => view.removeOnScrollListener(listener);
    }
  }

  getLiftOnScrollTargetView(): View | null {
    return this.target;
  }

  private onTargetScrolled(scrolled: boolean): void {
    if (this.liftOnScroll) this.setLifted(scrolled);
  }

  isLifted(): boolean {
    return this.lifted;
  }

  /** Lift (or lower) the bar, animating its container color. Returns whether it changed. */
  setLifted(lifted: boolean): boolean {
    if (this.lifted === lifted) return false;
    this.lifted = lifted;
    const theme = this.context.getTheme();
    const to = theme.getColor(lifted ? 'colorSurfaceContainer' : 'colorSurface');
    this.colorAnim?.cancel();
    const anim = ValueAnimator.ofObject(ArgbEvaluator.getInstance(), this.color, to);
    anim.setKernel(this.context.kernel);
    anim.setDuration(150);
    anim.addUpdateListener((a) => {
      this.color = a.getAnimatedValue() as number;
      this.setBackgroundColor(this.color);
    });
    this.colorAnim = anim;
    anim.start();
    return true;
  }
}
