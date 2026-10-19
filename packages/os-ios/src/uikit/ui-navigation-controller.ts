import {
  CGAffineTransformIdentity, CGAffineTransformMakeTranslation, type CGPoint,
} from '../core-graphics/geometry';
import { UIScreenEdgePanGestureRecognizer, UIRectEdge } from './gesture-recognizers';
import { UIColor } from './ui-color';
import { UIGestureRecognizerState, type UIGestureRecognizer } from './ui-gesture-recognizer';
import { NAVIGATION_BAR, UINavigationBar, type UINavigationItemContentView } from './ui-navigation-bar';
import { UIScrollView } from './ui-scroll-view';
import { UIView } from './ui-view';
import { UIViewController } from './ui-view-controller';

/**
 * UINavigationController: a stack of view controllers under a navigation
 * bar.
 *
 * Push: the new view slides in from the right edge while the one below
 * moves 30% of the width left under a light dim; pop reverses it. Both run
 * on a critically damped spring of 0.5 s response (UIKit's, as tuned for
 * React Native's stack with the motion oracle — docs/fidelity.md), and the
 * bar cross-fades the two items' content. The left-edge pan
 * (`interactivePopGestureRecognizer`) drags the same picture and finishes
 * past half the width or with a flick, carrying its velocity into the
 * spring.
 *
 * Every child sits under the bar, its safe area starting below it (the
 * expanded height when it shows a large title, which collapses as its
 * content scroll view scrolls). Appearance callbacks run will → did in
 * UIKit's order, and the delegate hears willShow / didShow.
 */
export enum UINavigationControllerOperation { none = 0, push = 1, pop = 2 }

export interface UINavigationControllerDelegate {
  navigationControllerWillShow?(navigationController: UINavigationController, viewController: UIViewController, animated: boolean): void;
  navigationControllerDidShow?(navigationController: UINavigationController, viewController: UIViewController, animated: boolean): void;
}

/** How far the view below moves left, and how dark it gets, while covered. */
const BELOW_SHIFT = 0.3;
const BELOW_DIM = 0.1;
const SPRING = { springDuration: 0.5, bounce: 0 };

class NavigationView extends UIView {
  constructor(private readonly controller: UINavigationController) {
    super();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.controller._layout();
  }
}

interface Transition {
  from: UIViewController;
  to: UIViewController;
  operation: UINavigationControllerOperation;
  dim: UIView;
  fromContent: UINavigationItemContentView | null;
  toContent: UINavigationItemContentView;
}

export class UINavigationController extends UIViewController {
  readonly navigationBar = new UINavigationBar();
  delegate: UINavigationControllerDelegate | null = null;
  readonly interactivePopGestureRecognizer: UIScreenEdgePanGestureRecognizer;
  private stack: UIViewController[] = [];
  private readonly wrapper = new UIView();
  private _barHidden = false;
  private transition: Transition | null = null;
  private interactive: Transition | null = null;
  private observedScroll: { scroll: UIScrollView; off: () => void } | null = null;

  constructor(rootViewController: UIViewController | null = null) {
    super();
    this.navigationBar._onBack = () => this.popViewController(true);
    this.interactivePopGestureRecognizer = new UIScreenEdgePanGestureRecognizer((g) => this.handleEdgePan(g));
    this.interactivePopGestureRecognizer.edges = UIRectEdge.left;
    if (rootViewController) this.setViewControllers([rootViewController], false);
  }

  override get _isNavigationController(): boolean {
    return true;
  }

  override loadView(): void {
    const view = new NavigationView(this);
    view.addSubview(this.wrapper);
    view.addSubview(this.navigationBar);
    view.addGestureRecognizer(this.interactivePopGestureRecognizer);
    this.view = view;
    const top = this.topViewController;
    if (top) this.wrapper.addSubview(top.view);
    this.syncBarItems();
  }

  // ── the stack ─────────────────────────────────────────────────────────

  get viewControllers(): readonly UIViewController[] {
    return this.stack;
  }

  set viewControllers(vcs: readonly UIViewController[]) {
    this.setViewControllers(vcs, false);
  }

  get topViewController(): UIViewController | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** The top controller, or what it presents modally. */
  get visibleViewController(): UIViewController | null {
    const top = this.topViewController;
    return top?.presentedViewController ?? top;
  }

  pushViewController(viewController: UIViewController, animated: boolean): void {
    if (this.stack.includes(viewController)) throw new Error('UINavigationController.pushViewController: the view controller is already on the stack');
    this.finishRunning();
    const from = this.topViewController;
    this.stack.push(viewController);
    this.addChild(viewController);
    if (!from || !animated || !this.isViewLoaded) {
      this.swapWithoutAnimation(from, viewController);
      return;
    }
    this.animate(from, viewController, UINavigationControllerOperation.push);
  }

  popViewController(animated: boolean): UIViewController | null {
    if (this.stack.length < 2) return null;
    this.finishRunning();
    const from = this.stack.pop()!;
    const to = this.topViewController!;
    if (!animated || !this.isViewLoaded) {
      this.swapWithoutAnimation(from, to);
      from.removeFromParent();
      return from;
    }
    this.animate(from, to, UINavigationControllerOperation.pop);
    return from;
  }

  popToRootViewController(animated: boolean): UIViewController[] | null {
    const root = this.stack[0];
    return root ? this.popToViewController(root, animated) : null;
  }

  popToViewController(viewController: UIViewController, animated: boolean): UIViewController[] | null {
    const at = this.stack.indexOf(viewController);
    if (at < 0 || at === this.stack.length - 1) return at < 0 ? null : [];
    // Everything above the target but the top leaves at once; the top pops.
    const popped = this.stack.splice(at + 1);
    const top = popped[popped.length - 1]!;
    for (const vc of popped.slice(0, -1)) {
      vc.viewIfLoaded?.removeFromSuperview();
      vc.removeFromParent();
    }
    this.stack.push(top);
    this.popViewController(animated);
    return popped;
  }

  setViewControllers(viewControllers: readonly UIViewController[], animated: boolean): void {
    this.finishRunning();
    const oldTop = this.topViewController;
    const next = viewControllers.slice();
    for (const vc of this.stack) {
      if (next.includes(vc)) continue;
      if (vc !== oldTop) vc.viewIfLoaded?.removeFromSuperview();
      vc.removeFromParent();
    }
    for (const vc of next) this.addChild(vc);
    const newTop = next[next.length - 1] ?? null;
    const wasInStack = !!newTop && this.stack.includes(newTop);
    this.stack = next;
    if (!newTop || newTop === oldTop) {
      this.syncBarItems();
      this.viewIfLoaded?.setNeedsLayout();
      return;
    }
    if (!oldTop || !animated || !this.isViewLoaded) {
      this.swapWithoutAnimation(oldTop, newTop);
      return;
    }
    this.animate(oldTop, newTop, wasInStack ? UINavigationControllerOperation.pop : UINavigationControllerOperation.push);
  }

  // ── the bar ───────────────────────────────────────────────────────────

  get isNavigationBarHidden(): boolean {
    return this._barHidden;
  }

  set isNavigationBarHidden(hidden: boolean) {
    this.setNavigationBarHidden(hidden, false);
  }

  setNavigationBarHidden(hidden: boolean, animated: boolean): void {
    this._barHidden = hidden;
    const apply = () => {
      this.navigationBar.alpha = hidden ? 0 : 1;
      this.viewIfLoaded?.setNeedsLayout();
      this.viewIfLoaded?.layoutIfNeeded();
    };
    if (animated) UIView.animate(0.25, apply);
    else UIView.performWithoutAnimation(apply);
  }

  private syncBarItems(): void {
    this.navigationBar._replaceItems(this.stack.map((vc) => vc.navigationItem));
    this.navigationBar._showTop();
  }

  // ── appearance forwarding ─────────────────────────────────────────────

  override viewWillAppear(animated: boolean): void {
    this.topViewController?.viewWillAppear(animated);
  }

  override viewDidAppear(animated: boolean): void {
    this.topViewController?.viewDidAppear(animated);
  }

  override viewWillDisappear(animated: boolean): void {
    this.topViewController?.viewWillDisappear(animated);
  }

  override viewDidDisappear(animated: boolean): void {
    this.topViewController?.viewDidDisappear(animated);
  }

  // ── layout ────────────────────────────────────────────────────────────

  /** @internal the navigation view's layout */
  _layout(): void {
    const view = this.view;
    const b = view.bounds.size;
    this.wrapper.frame = { origin: { x: 0, y: 0 }, size: b };
    const bar = this.navigationBar;
    bar._statusInset = view.safeAreaInsets.top;
    this.followContentScrollView();
    bar.frame = { origin: { x: 0, y: 0 }, size: { width: b.width, height: bar._statusInset + bar.barHeight } };
    bar.isHidden = this._barHidden && !this.transition;
    for (const vc of this.stack) {
      if (!vc.isViewLoaded || vc.view.superview !== this.wrapper) continue;
      const t = vc.view.transform;
      vc.view.transform = CGAffineTransformIdentity;
      vc.view.frame = { origin: { x: 0, y: 0 }, size: b };
      vc.view.transform = t;
      vc._setContainerInsets({ top: this._barHidden ? 0 : bar._insetHeight(vc.navigationItem), left: 0, bottom: 0, right: 0 });
    }
  }

  /** Large titles follow the top controller's content scroll view; the bar's look follows its edge. */
  private followContentScrollView(): void {
    const top = this.topViewController;
    const scroll = top?.isViewLoaded ? contentScrollView(top.view) : null;
    if (this.observedScroll?.scroll !== scroll) {
      this.observedScroll?.off();
      this.observedScroll = scroll ? { scroll, off: scroll._observeScroll(() => this.scrolled()) } : null;
    }
    this.scrolled(false);
  }

  private scrolled(relayout = true): void {
    const bar = this.navigationBar;
    const scroll = this.observedScroll?.scroll ?? null;
    let collapse = 0;
    let stretch = 0;
    let edge = true;
    if (scroll) {
      const rest = -scroll.adjustedContentInset.top;
      const dy = scroll.contentOffset.y - rest;
      collapse = Math.max(0, Math.min(1, dy / NAVIGATION_BAR.largeTitleHeight));
      stretch = Math.max(0, -dy);
      // The bar shows its standard look once content passes under it.
      const underBar = bar._showsLargeTitle(bar.topItem) ? dy - NAVIGATION_BAR.largeTitleHeight : dy;
      edge = underBar <= 0.5;
    }
    const changed = collapse !== bar._collapse || stretch !== bar._stretch || edge !== bar._atScrollEdge;
    bar._collapse = collapse;
    bar._stretch = stretch;
    bar._atScrollEdge = edge;
    if (!changed) return;
    bar.setNeedsDisplay();
    bar.setNeedsLayout();
    if (relayout) {
      const b = this.view.bounds.size;
      bar.frame = { origin: { x: 0, y: 0 }, size: { width: b.width, height: bar._statusInset + bar.barHeight } };
    }
  }

  // ── transitions ───────────────────────────────────────────────────────

  private swapWithoutAnimation(from: UIViewController | null, to: UIViewController): void {
    if (!this.isViewLoaded) {
      this.syncBarItems();
      return;
    }
    from?.viewWillDisappear(false);
    to.viewWillAppear(false);
    this.delegate?.navigationControllerWillShow?.(this, to, false);
    from?.viewIfLoaded?.removeFromSuperview();
    this.wrapper.addSubview(to.view);
    to.view.transform = CGAffineTransformIdentity;
    this.syncBarItems();
    this.view.setNeedsLayout();
    this.view.layoutIfNeeded();
    from?.viewDidDisappear(false);
    to.viewDidAppear(false);
    this.delegate?.navigationControllerDidShow?.(this, to, false);
  }

  /** Lay out both views and both bar items for a transition from `from` to `to`. */
  private begin(from: UIViewController, to: UIViewController, operation: UINavigationControllerOperation, animated: boolean): Transition {
    const width = this.view.bounds.size.width;
    const push = operation === UINavigationControllerOperation.push;
    from.viewWillDisappear(animated);
    to.viewWillAppear(animated);
    this.delegate?.navigationControllerWillShow?.(this, to, animated);
    const dim = new UIView();
    dim.backgroundColor = UIColor.black;
    dim.isUserInteractionEnabled = false;
    UIView.performWithoutAnimation(() => {
      dim.alpha = push ? 0 : BELOW_DIM;
      if (push) {
        this.wrapper.addSubview(dim);
        this.wrapper.addSubview(to.view);
        to.view.transform = CGAffineTransformMakeTranslation(width, 0);
      } else {
        this.wrapper.insertSubviewBelow(to.view, from.view);
        this.wrapper.insertSubviewBelow(dim, from.view);
        to.view.transform = CGAffineTransformMakeTranslation(-width * BELOW_SHIFT, 0);
      }
    });
    const bar = this.navigationBar;
    const fromContent = bar._contents[bar._contents.length - 1] ?? null;
    bar._replaceItems(this.stack.map((vc) => vc.navigationItem));
    const backItem = this.stack[this.stack.indexOf(to) - 1]?.navigationItem ?? null;
    const toContent = bar._makeContent(to.navigationItem, backItem);
    bar._contents.push(toContent);
    toContent.alpha = 0;
    this.view.setNeedsLayout();
    UIView.performWithoutAnimation(() => {
      this.view.layoutIfNeeded();
      // Large titles travel with their views.
      toContent.largeTitleLabel.transform = to.view.transform;
    });
    dim.frame = this.wrapper.bounds;
    const t: Transition = { from, to, operation, dim, fromContent, toContent };
    this.transition = t;
    return t;
  }

  /** The picture at the end of a transition (push or pop finished). */
  private endState(t: Transition): void {
    const width = this.view.bounds.size.width;
    t.to.view.transform = CGAffineTransformIdentity;
    if (t.operation === UINavigationControllerOperation.push) {
      t.from.view.transform = CGAffineTransformMakeTranslation(-width * BELOW_SHIFT, 0);
      t.dim.alpha = BELOW_DIM;
    } else {
      t.from.view.transform = CGAffineTransformMakeTranslation(width, 0);
      t.dim.alpha = 0;
    }
    if (t.fromContent) {
      t.fromContent.alpha = 0;
      t.fromContent.largeTitleLabel.transform = t.from.view.transform;
    }
    t.toContent.alpha = 1;
    t.toContent.largeTitleLabel.transform = CGAffineTransformIdentity;
    this.view.setNeedsLayout();
    this.view.layoutIfNeeded();
  }

  private finish(t: Transition, completed: boolean, animated: boolean): void {
    if (this.transition !== t) return;
    this.transition = null;
    t.dim.removeFromSuperview();
    const bar = this.navigationBar;
    if (completed) {
      t.from.view.removeFromSuperview();
      t.from.view.transform = CGAffineTransformIdentity;
      if (t.operation === UINavigationControllerOperation.pop) t.from.removeFromParent();
      bar._finishTransition(t.toContent);
      t.toContent.largeTitleLabel.transform = CGAffineTransformIdentity;
      t.from.viewDidDisappear(animated);
      t.to.viewDidAppear(animated);
      this.delegate?.navigationControllerDidShow?.(this, t.to, animated);
    } else {
      // A cancelled interactive pop: the top controller stays.
      t.to.view.removeFromSuperview();
      t.to.view.transform = CGAffineTransformIdentity;
      t.from.view.transform = CGAffineTransformIdentity;
      this.stack.push(t.from);
      bar._replaceItems(this.stack.map((vc) => vc.navigationItem));
      if (t.fromContent) {
        bar._finishTransition(t.fromContent);
        t.fromContent.largeTitleLabel.transform = CGAffineTransformIdentity;
      }
      t.to.viewWillDisappear(true);
      t.to.viewDidDisappear(true);
      t.from.viewWillAppear(true);
      t.from.viewDidAppear(true);
    }
    this.view.setNeedsLayout();
  }

  private animate(from: UIViewController, to: UIViewController, operation: UINavigationControllerOperation): void {
    const t = this.begin(from, to, operation, true);
    UIView.animate(SPRING, () => this.endState(t), () => this.finish(t, true, true));
  }

  /** A transition still running ends at once (UIKit queues; jumping to the end keeps state consistent). */
  private finishRunning(): void {
    const t = this.transition;
    if (!t || this.interactive === t) return;
    for (const v of [t.from.view, t.to.view, t.dim, t.toContent, t.fromContent]) v?.layer.removeAllAnimations();
    UIView.performWithoutAnimation(() => this.endState(t));
    this.finish(t, true, true);
  }

  // ── interactive pop ───────────────────────────────────────────────────

  private handleEdgePan(g: UIGestureRecognizer): void {
    const pan = g as UIScreenEdgePanGestureRecognizer;
    const S = UIGestureRecognizerState;
    const width = this.view.bounds.size.width || 1;
    switch (pan.state) {
      case S.began: {
        if (this.stack.length < 2 || this.transition) return;
        const from = this.stack.pop()!;
        const to = this.topViewController!;
        this.interactive = this.begin(from, to, UINavigationControllerOperation.pop, true);
        this.track(pan.translation(this.view));
        break;
      }
      case S.changed:
        if (this.interactive) this.track(pan.translation(this.view));
        break;
      case S.ended:
      case S.cancelled: {
        const t = this.interactive;
        if (!t) return;
        this.interactive = null;
        const progress = Math.max(0, Math.min(1, pan.translation(this.view).x / width));
        const v = pan.velocity(this.view).x;
        const complete = pan.state === S.ended && (v > 300 || (progress > 0.5 && v > -300));
        const remaining = complete ? (1 - progress) * width : progress * width;
        const relative = remaining > 1 ? (complete ? v : -v) / remaining : 0;
        UIView.animate({ ...SPRING, initialSpringVelocity: Math.max(0, relative) }, () => {
          if (complete) this.endState(t);
          else this.restoreState(t);
        }, () => this.finish(t, complete, true));
        break;
      }
    }
  }

  /** The interactive pop at `translation`. */
  private track(translation: CGPoint): void {
    const t = this.interactive;
    if (!t) return;
    const width = this.view.bounds.size.width || 1;
    const p = Math.max(0, Math.min(1, translation.x / width));
    UIView.performWithoutAnimation(() => {
      t.from.view.transform = CGAffineTransformMakeTranslation(p * width, 0);
      t.to.view.transform = CGAffineTransformMakeTranslation(-width * BELOW_SHIFT * (1 - p), 0);
      t.dim.alpha = BELOW_DIM * (1 - p);
      if (t.fromContent) {
        t.fromContent.alpha = 1 - p;
        t.fromContent.largeTitleLabel.transform = t.from.view.transform;
      }
      t.toContent.alpha = p;
      t.toContent.largeTitleLabel.transform = t.to.view.transform;
    });
  }

  /** The picture before an interactive pop started. */
  private restoreState(t: Transition): void {
    const width = this.view.bounds.size.width;
    t.from.view.transform = CGAffineTransformIdentity;
    t.to.view.transform = CGAffineTransformMakeTranslation(-width * BELOW_SHIFT, 0);
    t.dim.alpha = BELOW_DIM;
    if (t.fromContent) {
      t.fromContent.alpha = 1;
      t.fromContent.largeTitleLabel.transform = CGAffineTransformIdentity;
    }
    t.toContent.alpha = 0;
    t.toContent.largeTitleLabel.transform = t.to.view.transform;
  }

  /** @internal is a transition running (tests, the tab bar controller)? */
  get _isTransitioning(): boolean {
    return this.transition !== null;
  }
}

/** UIKit's content scroll view of a controller: its view, or the first scroll view inside, breadth first. */
function contentScrollView(view: UIView): UIScrollView | null {
  const queue: UIView[] = [view];
  while (queue.length) {
    const v = queue.shift()!;
    if (v instanceof UIScrollView && !v.horizontal) return v;
    queue.push(...v.subviews);
  }
  return null;
}
