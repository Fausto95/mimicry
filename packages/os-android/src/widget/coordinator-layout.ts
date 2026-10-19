import type { FrameTask } from '@mimicry/os-core';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { FrameLayout, FrameLayoutParams, ViewGroup, marginsOf } from '../view/view-group';

/**
 * androidx.coordinatorlayout.widget.CoordinatorLayout with the two
 * behaviors screens rely on most:
 *
 * - ScrollingViewBehavior (app:layout_behavior="@string/appbar_scrolling_view_behavior"):
 *   the scrolling content sits below the AppBarLayout and fills the rest;
 * - FloatingActionButton's default behavior: a FAB moves up out of the way
 *   of a Snackbar shown in the coordinator, frame by frame as it slides.
 *
 * Otherwise it lays children out like a FrameLayout (layout_gravity,
 * margins). Scroll flags (collapsing, enterAlways) are not modeled.
 */
export abstract class Behavior {
  /** Lay `child` out; return true when handled (otherwise the FrameLayout rules apply). */
  onLayoutChild(_parent: CoordinatorLayout, _child: View): boolean {
    return false;
  }
  onMeasureChild(_parent: CoordinatorLayout, _child: View, _widthSpec: number, _heightSpec: number): boolean {
    return false;
  }
  /** Called every frame something it depends on moves. */
  onDependentViewChanged(_parent: CoordinatorLayout, _child: View, _dependency: View): boolean {
    return false;
  }
  layoutDependsOn(_parent: CoordinatorLayout, _child: View, _dependency: View): boolean {
    return false;
  }
}

/** Views registered as Snackbar layouts (the snackbar module registers its views). */
export const snackbarViews = new WeakSet<View>();

/** Views that are app bars (AppBarLayout registers itself through `isAppBar`). */
const appBarClassNames = new Set(['AppBarLayout']);

const isAppBar = (v: View) => {
  for (let c: object | null = Object.getPrototypeOf(v); c && c !== Object.prototype; c = Object.getPrototypeOf(c)) {
    if (appBarClassNames.has((c as { constructor: { name: string } }).constructor.name)) return true;
  }
  return false;
};

export class ScrollingViewBehavior extends Behavior {
  override onMeasureChild(parent: CoordinatorLayout, child: View, widthSpec: number, heightSpec: number): boolean {
    const bar = parent.appBar();
    if (!bar) return false;
    const lp = child.getLayoutParams() ?? new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
    const m = marginsOf(lp);
    const available = MeasureSpec.getSize(heightSpec) - bar.getMeasuredHeight();
    child.measure(
      ViewGroup.getChildMeasureSpec(widthSpec, m.left + m.right + parent.getPaddingLeft() + parent.getPaddingRight(), lp.width),
      ViewGroup.getChildMeasureSpec(MeasureSpec.makeMeasureSpec(Math.max(0, available), MeasureSpec.getMode(heightSpec)), m.top + m.bottom, lp.height),
    );
    return true;
  }

  override onLayoutChild(parent: CoordinatorLayout, child: View): boolean {
    const bar = parent.appBar();
    if (!bar) return false;
    const m = marginsOf(child.getLayoutParams());
    const top = bar.getBottom() + m.top;
    const left = parent.getPaddingLeft() + m.left;
    child.layout(left, top, left + child.getMeasuredWidth(), top + child.getMeasuredHeight());
    return true;
  }

  override layoutDependsOn(_parent: CoordinatorLayout, _child: View, dependency: View): boolean {
    return isAppBar(dependency);
  }
}

/** FloatingActionButton.Behavior: keep clear of snackbars. */
export class FloatingActionButtonBehavior extends Behavior {
  override layoutDependsOn(_parent: CoordinatorLayout, _child: View, dependency: View): boolean {
    return snackbarViews.has(dependency);
  }

  override onDependentViewChanged(parent: CoordinatorLayout, child: View): boolean {
    let offset = 0;
    for (const v of parent.childViews) {
      if (!snackbarViews.has(v) || v.getVisibility() !== View.VISIBLE) continue;
      // keep the child 16 dp above the snackbar's top while it overlaps
      const snackTop = v.getTop() + v.getTranslationY();
      offset = Math.min(offset, snackTop - 16 - child.getBottom());
    }
    if (child.getTranslationY() === offset) return false;
    child.setTranslationY(Math.min(0, offset));
    return true;
  }
}

export class CoordinatorLayoutParams extends FrameLayoutParams {
  behavior: Behavior | null = null;

  constructor(width: number | LayoutParams = LayoutParams.MATCH_PARENT, height: number = LayoutParams.MATCH_PARENT, gravity = -1) {
    super(width, height, gravity);
    if (width instanceof CoordinatorLayoutParams) this.behavior = width.behavior;
  }

  setBehavior(behavior: Behavior | null): void {
    this.behavior = behavior;
  }

  getBehavior(): Behavior | null {
    return this.behavior;
  }
}

export class CoordinatorLayout extends FrameLayout implements FrameTask {
  static override readonly LayoutParams = CoordinatorLayoutParams;
  private tracking = false;

  /** @internal the first AppBarLayout child */
  appBar(): View | null {
    return this.childViews.find((c) => c.getVisibility() !== View.GONE && isAppBar(c)) ?? null;
  }

  private behaviorOf(child: View): Behavior | null {
    const lp = child.getLayoutParams();
    if (lp instanceof CoordinatorLayoutParams && lp.behavior) return lp.behavior;
    // FloatingActionButton's @DefaultBehavior
    if (child.constructor.name === 'FloatingActionButton' || child.constructor.name === 'ExtendedFloatingActionButton') return defaultFabBehavior;
    return null;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    const exactly = (n: number) => MeasureSpec.makeMeasureSpec(n, MeasureSpec.EXACTLY);
    for (const child of this.childViews) {
      const behavior = this.behaviorOf(child);
      if (behavior && child.getVisibility() !== View.GONE) behavior.onMeasureChild(this, child, exactly(this.getMeasuredWidth()), exactly(this.getMeasuredHeight() - this.getPaddingTop() - this.getPaddingBottom()));
    }
  }

  protected override onLayout(changed: boolean, l: number, t: number, r: number, b: number): void {
    super.onLayout(changed, l, t, r, b);
    for (const child of this.childViews) {
      const behavior = this.behaviorOf(child);
      if (behavior && child.getVisibility() !== View.GONE) behavior.onLayoutChild(this, child);
    }
    this.dispatchDependentViewsChanged();
  }

  override onViewAdded(child: View): void {
    super.onViewAdded(child);
    if (snackbarViews.has(child)) this.startTracking();
  }

  override onViewRemoved(child: View): void {
    super.onViewRemoved(child);
    if (snackbarViews.has(child)) this.dispatchDependentViewsChanged();
  }

  /** While a snackbar is a child, dependents follow it every frame (onDependentViewChanged on pre-draw). */
  private startTracking(): void {
    if (this.tracking) return;
    const kernel = this.context.kernel;
    this.tracking = true;
    kernel.animator.add(this);
    kernel.requestFrame();
  }

  tick(): boolean {
    this.dispatchDependentViewsChanged();
    const keep = this.childViews.some((c) => snackbarViews.has(c));
    this.tracking = keep;
    return keep;
  }

  private dispatchDependentViewsChanged(): void {
    for (const child of this.childViews) {
      const behavior = this.behaviorOf(child);
      if (!behavior) continue;
      for (const other of this.childViews) {
        if (other !== child && behavior.layoutDependsOn(this, child, other)) behavior.onDependentViewChanged(this, child, other);
      }
      if (behavior instanceof FloatingActionButtonBehavior && !this.childViews.some((c) => snackbarViews.has(c))) behavior.onDependentViewChanged(this, child);
    }
  }
}

const defaultFabBehavior = new FloatingActionButtonBehavior();
