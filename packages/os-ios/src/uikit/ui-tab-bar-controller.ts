import { TAB_BAR, UITabBar } from './ui-tab-bar';
import type { UITabBarItem } from './ui-tab-bar-item';
import { UIView } from './ui-view';
import { UIViewController } from './ui-view-controller';

/**
 * UITabBarController: one child shown at a time under the floating tab bar.
 * Children run under the bar; it is part of their bottom safe area. Tapping
 * a tab asks the delegate, switches (appearance callbacks in UIKit's order)
 * and tells the delegate; tapping the selected tab pops its navigation
 * controller to the root.
 */
export interface UITabBarControllerDelegate {
  tabBarControllerShouldSelect?(controller: UITabBarController, viewController: UIViewController): boolean;
  tabBarControllerDidSelect?(controller: UITabBarController, viewController: UIViewController): void;
}

class TabBarView extends UIView {
  constructor(private readonly controller: UITabBarController) {
    super();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.controller._layout();
  }
}

export class UITabBarController extends UIViewController {
  readonly tabBar = new UITabBar();
  delegate: UITabBarControllerDelegate | null = null;
  private _viewControllers: UIViewController[] = [];
  private _selectedIndex = 0;
  private readonly container = new UIView();

  constructor() {
    super();
    this.tabBar._onTap = (item) => this.tapped(item);
  }

  override get _isTabBarController(): boolean {
    return true;
  }

  override loadView(): void {
    const view = new TabBarView(this);
    view.addSubview(this.container);
    view.addSubview(this.tabBar);
    this.view = view;
    this.showSelected(null, false);
  }

  get viewControllers(): readonly UIViewController[] {
    return this._viewControllers;
  }

  set viewControllers(vcs: readonly UIViewController[] | null) {
    this.setViewControllers(vcs ? [...vcs] : [], false);
  }

  setViewControllers(vcs: UIViewController[], _animated: boolean): void {
    const old = this.selectedViewController;
    for (const vc of this._viewControllers) {
      if (vcs.includes(vc)) continue;
      vc.viewIfLoaded?.removeFromSuperview();
      vc.removeFromParent();
    }
    this._viewControllers = vcs.slice();
    for (const vc of vcs) this.addChild(vc);
    this._selectedIndex = Math.max(0, Math.min(this._selectedIndex, vcs.length - 1));
    this.tabBar.setItems(vcs.map((vc) => vc.tabBarItem), false);
    this.tabBar.selectedItem = this.selectedViewController?.tabBarItem ?? null;
    if (this.isViewLoaded) this.showSelected(old && old !== this.selectedViewController ? old : null, false);
  }

  override _childTabBarItemChanged(): void {
    this.tabBar.setItems(this._viewControllers.map((vc) => vc.tabBarItem), false);
    this.tabBar.selectedItem = this.selectedViewController?.tabBarItem ?? null;
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  set selectedIndex(index: number) {
    if (index < 0 || index >= this._viewControllers.length || index === this._selectedIndex) return;
    const old = this.selectedViewController;
    this._selectedIndex = index;
    this.tabBar.selectedItem = this.selectedViewController?.tabBarItem ?? null;
    if (this.isViewLoaded) this.showSelected(old, false);
  }

  get selectedViewController(): UIViewController | null {
    return this._viewControllers[this._selectedIndex] ?? null;
  }

  set selectedViewController(vc: UIViewController | null) {
    const at = vc ? this._viewControllers.indexOf(vc) : -1;
    if (at >= 0) this.selectedIndex = at;
  }

  private tapped(item: UITabBarItem): void {
    const index = this._viewControllers.findIndex((vc) => vc.tabBarItem === item);
    const vc = this._viewControllers[index];
    if (!vc) return;
    if (this.delegate?.tabBarControllerShouldSelect && !this.delegate.tabBarControllerShouldSelect(this, vc)) return;
    if (index === this._selectedIndex) {
      const nav = vc as unknown as { _isNavigationController?: boolean; popToRootViewController?(animated: boolean): unknown };
      if (nav._isNavigationController) nav.popToRootViewController?.(true);
    } else {
      this.selectedIndex = index;
    }
    this.delegate?.tabBarControllerDidSelect?.(this, vc);
  }

  private showSelected(old: UIViewController | null, animated: boolean): void {
    const next = this.selectedViewController;
    if (old === next) return;
    old?.viewWillDisappear(animated);
    next?.viewWillAppear(animated);
    old?.viewIfLoaded?.removeFromSuperview();
    if (next) this.container.addSubview(next.view);
    this.view.setNeedsLayout();
    this.view.layoutIfNeeded();
    old?.viewDidDisappear(animated);
    next?.viewDidAppear(animated);
  }

  /** @internal */
  _layout(): void {
    const b = this.view.bounds.size;
    this.container.frame = { origin: { x: 0, y: 0 }, size: b };
    const screenBottom = this.view.window?.application?.screen.safeAreaInsets.bottom ?? 0;
    this.tabBar.frame = {
      origin: { x: TAB_BAR.sideMargin, y: b.height - TAB_BAR.bottomMargin - TAB_BAR.height },
      size: { width: b.width - TAB_BAR.sideMargin * 2, height: TAB_BAR.height },
    };
    const inset = this.tabBar.isHidden ? 0 : Math.max(0, TAB_BAR.height + TAB_BAR.bottomMargin - screenBottom);
    for (const vc of this._viewControllers) {
      vc._setContainerInsets({ top: 0, left: 0, bottom: inset, right: 0 });
      if (vc.isViewLoaded && vc.view.superview === this.container) vc.view.frame = { origin: { x: 0, y: 0 }, size: b };
    }
  }

  override viewWillAppear(animated: boolean): void {
    this.selectedViewController?.viewWillAppear(animated);
  }

  override viewDidAppear(animated: boolean): void {
    this.selectedViewController?.viewDidAppear(animated);
  }
}
