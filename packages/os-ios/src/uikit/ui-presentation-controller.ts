import { CGAffineTransformIdentity, CGAffineTransformMakeTranslation, type CGRect } from '../core-graphics/geometry';
import type { PresentationControllerLike, PresentedEntry } from './presentation';
import { UIView } from './ui-view';
import { UIModalPresentationStyle, UIModalTransitionStyle, type UIViewController } from './ui-view-controller';
import type { UIWindow } from './ui-window';

/**
 * UIPresentationController: how a presented view controller sits in the
 * window. This base class does the full-screen family: `fullScreen`
 * (the presenter's view goes away once covered), `overFullScreen` and
 * `overCurrentContext` (it stays), each arriving with its
 * modalTransitionStyle — cover vertical (UIKit's presentation spring,
 * 0.5 s critically damped, from the bottom edge) or cross dissolve. Flip
 * and curl styles cross-dissolve (see docs/os-ios.md).
 */
export interface UIAdaptivePresentationControllerDelegate {
  presentationControllerShouldDismiss?(controller: UIPresentationController): boolean;
  presentationControllerWillDismiss?(controller: UIPresentationController): void;
  presentationControllerDidDismiss?(controller: UIPresentationController): void;
  presentationControllerDidAttemptToDismiss?(controller: UIPresentationController): void;
}

/** UIKit's presentation spring (react-native-screens' modal, tuned with the motion oracle). */
export const PRESENTATION_SPRING = { springDuration: 0.5, bounce: 0 };

/** UITransitionView: a full-window container per presentation. */
export class UITransitionView extends UIView {
  constructor(private readonly controller: UIPresentationController) {
    super();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.controller._layout();
  }

  /** Empty areas of a container that does not dim let touches through to what is below. */
  override hitTest(point: { x: number; y: number }, event: import('./ui-event').UIEvent | null): UIView | null {
    const hit = super.hitTest(point, event);
    return hit === this ? null : hit;
  }
}

export class UIPresentationController implements PresentationControllerLike {
  delegate: UIAdaptivePresentationControllerDelegate | null = null;
  readonly containerView: UIView;
  protected window: UIWindow | null = null;
  protected entry: PresentedEntry | null = null;
  private hiddenPresenter: UIView | null = null;

  /** @internal set when the presentation starts (the controller may exist before, to take a delegate) */
  _presenting: UIViewController | null;

  constructor(readonly presentedViewController: UIViewController, presentingViewController: UIViewController | null) {
    this._presenting = presentingViewController;
    this.containerView = new UITransitionView(this);
  }

  get presentingViewController(): UIViewController {
    return this._presenting ?? this.presentedViewController;
  }

  get presentedView(): UIView {
    return this.presentedViewController.view;
  }

  get presentationStyle(): UIModalPresentationStyle {
    return this.presentedViewController.modalPresentationStyle;
  }

  get shouldRemovePresentersView(): boolean {
    return this.presentationStyle === UIModalPresentationStyle.fullScreen;
  }

  /** frameOfPresentedViewInContainerView */
  get frameOfPresentedViewInContainerView(): CGRect {
    return this.containerView.bounds;
  }

  // Override points (UIKit calls these around transitions).
  presentationTransitionWillBegin(): void {}
  presentationTransitionDidEnd(_completed: boolean): void {}
  dismissalTransitionWillBegin(): void {}
  dismissalTransitionDidEnd(_completed: boolean): void {}
  containerViewWillLayoutSubviews(): void {}
  containerViewDidLayoutSubviews(): void {}

  /** @internal */
  _attach(window: UIWindow, entry: PresentedEntry): void {
    this.window = window;
    this.entry = entry;
    this.containerView.frame = window.bounds;
    this.containerView.addSubview(this.presentedView);
  }

  /** The view that shows the presenting controller (the root view, or the container of a presented one). */
  protected presenterView(): UIView | null {
    const window = this.window;
    if (!window) return null;
    let vc: UIViewController | null = this.presentingViewController;
    while (vc) {
      const presented = window.presentation.entryFor(vc);
      if (presented) return presented.container;
      if (vc === window.rootViewController) return vc.view;
      vc = vc.parent;
    }
    return window.rootViewController?.viewIfLoaded ?? null;
  }

  /** @internal */
  _layout(): void {
    this.containerViewWillLayoutSubviews();
    if (this.window) this.containerView.frame = this.window.bounds;
    const f = this.frameOfPresentedViewInContainerView;
    const view = this.presentedView;
    const t = view.transform;
    view.transform = CGAffineTransformIdentity;
    view.frame = f;
    view.transform = t;
    this.containerViewDidLayoutSubviews();
  }

  private get fades(): boolean {
    return this.presentedViewController.modalTransitionStyle !== UIModalTransitionStyle.coverVertical;
  }

  /** @internal */
  _present(animated: boolean, done: () => void): void {
    this.presentationTransitionWillBegin();
    this._layout();
    const view = this.presentedView;
    const finish = () => {
      if (this.shouldRemovePresentersView) {
        const presenter = this.presenterView();
        if (presenter && !presenter.isHidden) {
          presenter.isHidden = true;
          this.hiddenPresenter = presenter;
        }
      }
      this.presentationTransitionDidEnd(true);
      done();
    };
    if (!animated) {
      finish();
      return;
    }
    if (this.fades) {
      UIView.performWithoutAnimation(() => (view.alpha = 0));
      UIView.animate(0.3, () => (view.alpha = 1), finish);
      return;
    }
    const height = this.containerView.bounds.size.height;
    UIView.performWithoutAnimation(() => (view.transform = CGAffineTransformMakeTranslation(0, height)));
    UIView.animate(PRESENTATION_SPRING, () => (view.transform = CGAffineTransformIdentity), finish);
  }

  /** @internal */
  _dismiss(animated: boolean, done: () => void): void {
    this.dismissalTransitionWillBegin();
    if (this.hiddenPresenter) {
      this.hiddenPresenter.isHidden = false;
      this.hiddenPresenter = null;
    }
    const view = this.presentedView;
    const finish = () => {
      this.dismissalTransitionDidEnd(true);
      done();
    };
    if (!animated) {
      finish();
      return;
    }
    if (this.fades) {
      UIView.animate(0.3, () => (view.alpha = 0), finish);
      return;
    }
    const height = this.containerView.bounds.size.height;
    UIView.animate(PRESENTATION_SPRING, () => (view.transform = CGAffineTransformMakeTranslation(0, height)), finish);
  }

  /** @internal the presentation is over: the presented view is free again */
  _finished(): void {
    const view = this.presentedViewController.viewIfLoaded;
    if (view) {
      view.removeFromSuperview();
      UIView.performWithoutAnimation(() => {
        view.transform = CGAffineTransformIdentity;
        view.alpha = 1;
      });
    }
  }
}
