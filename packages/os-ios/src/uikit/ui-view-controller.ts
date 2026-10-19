import { UIEdgeInsetsZero, type UIEdgeInsets } from '../core-graphics/geometry';
import { UIResponder } from './ui-responder';
import { UIUserInterfaceStyle } from './ui-trait-collection';
import { UIView } from './ui-view';
import { UINavigationItem } from './ui-navigation-item';
import { UITabBarItem } from './ui-tab-bar-item';
import { UIPresentationController } from './ui-presentation-controller';
import { UISheetPresentationController } from './ui-sheet-presentation-controller';

/**
 * UIViewController: owns a view (loaded lazily through loadView /
 * viewDidLoad), takes part in the responder chain, adds safe area insets
 * for its descendants and forwards appearance callbacks to its children.
 * Presentation (present / dismiss) is implemented by UIKit's presentation
 * machinery (presentation.ts).
 */
export enum UIModalPresentationStyle {
  automatic = -2, none = -1, fullScreen = 0, pageSheet = 1, formSheet = 2, currentContext = 3,
  custom = 4, overFullScreen = 5, overCurrentContext = 6, popover = 7,
}
export enum UIModalTransitionStyle { coverVertical = 0, flipHorizontal = 1, crossDissolve = 2, partialCurl = 3 }
export enum UIStatusBarStyle { default = 0, lightContent = 1, darkContent = 3 }

export class UIViewController extends UIResponder {
  private _view: UIView | null = null;
  private _parent: UIViewController | null = null;
  private readonly _children: UIViewController[] = [];
  private _additionalSafeAreaInsets: UIEdgeInsets = UIEdgeInsetsZero;
  /** insets a container adds for its bars (navigation bar, tab bar) */
  private _containerInsets: UIEdgeInsets = UIEdgeInsetsZero;
  private _title: string | null = null;
  private _navigationItem: UINavigationItem | null = null;
  private _tabBarItem: UITabBarItem | null = null;
  /** pushed onto a navigation controller inside a tab bar controller: hide the tab bar */
  hidesBottomBarWhenPushed = false;
  overrideUserInterfaceStyle = UIUserInterfaceStyle.unspecified;
  modalPresentationStyle = UIModalPresentationStyle.automatic;
  modalTransitionStyle = UIModalTransitionStyle.coverVertical;
  isModalInPresentation = false;
  definesPresentationContext = false;
  preferredStatusBarStyle = UIStatusBarStyle.default;
  prefersStatusBarHidden = false;
  /** @internal set by the presentation machinery */
  _presentedViewController: UIViewController | null = null;
  /** @internal */
  _isBeingPresented = false;
  /** @internal */
  _isBeingDismissed = false;
  private _presentationController: UIPresentationController | null = null;
  /** @internal */
  _presentingViewController: UIViewController | null = null;

  get next(): UIResponder | null {
    return this._view?.superview ?? this._parent ?? null;
  }

  /** Setting the title also titles the navigation item and the tab bar item (UIKit does). */
  get title(): string | null {
    return this._title;
  }

  set title(title: string | null) {
    this._title = title;
    if (this._navigationItem) this._navigationItem.title = title;
    if (this._tabBarItem && this._tabBarItem.title === null) this._tabBarItem.title = title;
  }

  get navigationItem(): UINavigationItem {
    return (this._navigationItem ??= new UINavigationItem(this._title));
  }

  get tabBarItem(): UITabBarItem {
    return (this._tabBarItem ??= new UITabBarItem(this._title, null, null));
  }

  set tabBarItem(item: UITabBarItem) {
    this._tabBarItem = item;
    this._parent?._childTabBarItemChanged();
  }

  /** @internal a child's tab bar item changed (UITabBarController redraws its bar) */
  _childTabBarItemChanged(): void {}

  /** The nearest navigation controller up the parent chain. */
  get navigationController(): UIViewController | null {
    for (let p = this._parent; p; p = p._parent) if (p._isNavigationController) return p;
    return null;
  }

  /** The nearest tab bar controller up the parent chain. */
  get tabBarController(): UIViewController | null {
    for (let p = this._parent; p; p = p._parent) if (p._isTabBarController) return p;
    return null;
  }

  /** @internal */
  get _isNavigationController(): boolean {
    return false;
  }

  /** @internal */
  get _isTabBarController(): boolean {
    return false;
  }

  // ── view lifecycle ──────────────────────────────────────────────────

  get view(): UIView {
    if (!this._view) {
      this.loadView();
      if (!this._view) this.setView(new UIView());
      this.viewDidLoad();
    }
    return this._view!;
  }

  set view(view: UIView) {
    this.setView(view);
  }

  get isViewLoaded(): boolean {
    return this._view !== null;
  }

  get viewIfLoaded(): UIView | null {
    return this._view;
  }

  private setView(view: UIView): void {
    if (this._view) this._view._viewController = null;
    this._view = view;
    view._viewController = this;
  }

  /** Override to create the view hierarchy; assign `this.view`. */
  loadView(): void {}
  viewDidLoad(): void {}
  viewWillAppear(_animated: boolean): void {}
  viewDidAppear(_animated: boolean): void {}
  viewWillDisappear(_animated: boolean): void {}
  viewDidDisappear(_animated: boolean): void {}
  viewWillLayoutSubviews(): void {}
  viewDidLayoutSubviews(): void {}
  viewSafeAreaInsetsDidChange(): void {}

  // ── containment ─────────────────────────────────────────────────────

  get parent(): UIViewController | null {
    return this._parent;
  }

  get children(): readonly UIViewController[] {
    return this._children;
  }

  addChild(child: UIViewController): void {
    if (child._parent === this) return;
    child.removeFromParent();
    child.willMove(this);
    this._children.push(child);
    child._parent = this;
  }

  removeFromParent(): void {
    const parent = this._parent;
    if (!parent) return;
    const at = parent._children.indexOf(this);
    if (at >= 0) parent._children.splice(at, 1);
    this._parent = null;
    this.didMove(null);
  }

  willMove(_toParent: UIViewController | null): void {}
  didMove(_toParent: UIViewController | null): void {}

  // ── safe area ───────────────────────────────────────────────────────

  get additionalSafeAreaInsets(): UIEdgeInsets {
    return this._additionalSafeAreaInsets;
  }

  set additionalSafeAreaInsets(insets: UIEdgeInsets) {
    this._additionalSafeAreaInsets = insets;
    this._view?.setNeedsLayout();
    this.viewSafeAreaInsetsDidChange();
  }

  /** @internal a container's bars inset this controller's view (on top of additionalSafeAreaInsets) */
  _setContainerInsets(insets: UIEdgeInsets): void {
    const c = this._containerInsets;
    if (c.top === insets.top && c.left === insets.left && c.bottom === insets.bottom && c.right === insets.right) return;
    this._containerInsets = insets;
    this._view?.setNeedsLayout();
    this.viewSafeAreaInsetsDidChange();
  }

  /** @internal what this controller's view adds to the safe area of what it contains */
  get _safeAreaExtension(): UIEdgeInsets {
    const a = this._additionalSafeAreaInsets;
    const c = this._containerInsets;
    return { top: a.top + c.top, left: a.left + c.left, bottom: a.bottom + c.bottom, right: a.right + c.right };
  }

  // ── presentation ────────────────────────────────────────────────────

  get presentedViewController(): UIViewController | null {
    return this._presentedViewController;
  }

  get presentingViewController(): UIViewController | null {
    return this._presentingViewController ?? this._parent?.presentingViewController ?? null;
  }

  get isBeingPresented(): boolean {
    return this._isBeingPresented;
  }

  get isBeingDismissed(): boolean {
    return this._isBeingDismissed;
  }

  /** The style a presentation uses: `automatic` is a page sheet on iOS 13+. */
  get resolvedModalPresentationStyle(): UIModalPresentationStyle {
    const style = this.modalPresentationStyle;
    return style === UIModalPresentationStyle.automatic || style === UIModalPresentationStyle.popover ? UIModalPresentationStyle.pageSheet : style;
  }

  /** The presentation controller for this controller's modal style (made on first use, like UIKit's). */
  get presentationController(): UIPresentationController {
    const sheet = this.resolvedModalPresentationStyle === UIModalPresentationStyle.pageSheet || this.resolvedModalPresentationStyle === UIModalPresentationStyle.formSheet;
    const current = this._presentationController;
    if (!current || current instanceof UISheetPresentationController !== sheet) {
      this._presentationController = sheet ? new UISheetPresentationController(this, null) : new UIPresentationController(this, null);
    }
    return this._presentationController!;
  }

  /** The sheet presentation controller, when presented as a sheet. */
  get sheetPresentationController(): UISheetPresentationController | null {
    const controller = this.presentationController;
    return controller instanceof UISheetPresentationController ? controller : null;
  }

  /** @internal the controller a presentation by `presenting` runs with */
  _makePresentationController(presenting: UIViewController): UIPresentationController {
    const controller = this.presentationController;
    controller._presenting = presenting;
    return controller;
  }

  present(viewController: UIViewController, animated: boolean, completion?: () => void): void {
    const window = this.view.window;
    if (!window) throw new Error('UIViewController.present: the presenting view controller is not in a window');
    window.presentation.present(this, viewController, animated, completion);
  }

  dismiss(animated: boolean, completion?: () => void): void {
    const target = this._presentedViewController ? this : this.presentingViewController;
    const window = (target ?? this).view.window ?? this.view.window;
    if (!target || !window) {
      completion?.();
      return;
    }
    window.presentation.dismiss(target, animated, completion);
  }

  setNeedsStatusBarAppearanceUpdate(): void {
    this._view?.window?.application?.statusBarAppearanceChanged();
  }
}
