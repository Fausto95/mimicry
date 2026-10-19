import { UIEdgeInsetsZero, type UIEdgeInsets } from '../core-graphics/geometry';
import { UIResponder } from './ui-responder';
import { UIUserInterfaceStyle } from './ui-trait-collection';
import { UIView } from './ui-view';

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
  title: string | null = null;
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
  _presentingViewController: UIViewController | null = null;

  get next(): UIResponder | null {
    return this._view?.superview ?? this._parent ?? null;
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

  // ── presentation ────────────────────────────────────────────────────

  get presentedViewController(): UIViewController | null {
    return this._presentedViewController;
  }

  get presentingViewController(): UIViewController | null {
    return this._presentingViewController ?? this._parent?.presentingViewController ?? null;
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
