import { alphaOf } from '@mimicry/protocol';
import { multiply, scaling, translation, type LayerContext } from '@mimicry/os-core';
import {
  CGAffineTransformIdentity, CGAffineTransformMakeTranslation, fromMatrix, type CGPoint, type CGRect,
} from '../core-graphics/geometry';
import { iosKit } from '../theme';
import { UIPanGestureRecognizer, UITapGestureRecognizer } from './gesture-recognizers';
import { UIColor } from './ui-color';
import { UIGestureRecognizerState, type UIGestureRecognizer } from './ui-gesture-recognizer';
import { PRESENTATION_SPRING, UIPresentationController } from './ui-presentation-controller';
import { UIScrollView, UIScrollViewPanGestureRecognizer } from './ui-scroll-view';
import { UIView } from './ui-view';
import type { UIViewController } from './ui-view-controller';
import type { UIWindow } from './ui-window';
import type { PresentedEntry } from './presentation';

/**
 * UISheetPresentationController: page and form sheets on iPhone.
 *
 * The sheet is a card whose largest (`.large`) position leaves a gap under
 * the status bar (iosKit.tokens.sheetTopGap) with rounded top corners
 * (preferredCornerRadius, else tokens.sheetRadius). While a sheet stands at
 * its large detent, the presenter's view scales back (tokens.pageSheetScale)
 * and moves down under the status bar with the same corner radius, over
 * black, slightly dimmed — and the status bar turns light. Smaller detents
 * (`.medium` is half the container, custom detents resolve a height) dim
 * whatever is above `largestUndimmedDetentIdentifier` instead.
 *
 * The sheet can be dragged by its content: between detents, and down to
 * dismiss past a third of its height or with a flick — unless
 * isModalInPresentation, when it springs back and tells the delegate it
 * tried. Inside the sheet, a scroll view keeps the drag until it is at its
 * top edge (or, at a smaller detent, until the sheet has expanded).
 * Tapping the dimmed area dismisses too.
 */
export interface UISheetPresentationControllerDetentResolutionContext {
  readonly maximumDetentValue: number;
  readonly containerTraitCollection: unknown;
}

export class UISheetPresentationControllerDetent {
  private constructor(
    readonly identifier: string,
    private readonly resolver: (context: UISheetPresentationControllerDetentResolutionContext) => number | null,
  ) {}

  static medium(): UISheetPresentationControllerDetent {
    return new UISheetPresentationControllerDetent(UISheetPresentationControllerDetentIdentifier.medium, (c) => c.maximumDetentValue / 2);
  }

  static large(): UISheetPresentationControllerDetent {
    return new UISheetPresentationControllerDetent(UISheetPresentationControllerDetentIdentifier.large, (c) => c.maximumDetentValue);
  }

  /** custom(identifier:resolver:) — iOS 16 */
  static custom(identifier: string | null, resolver: (context: UISheetPresentationControllerDetentResolutionContext) => number | null): UISheetPresentationControllerDetent {
    return new UISheetPresentationControllerDetent(identifier ?? `custom-${Math.random().toString(36).slice(2)}`, resolver);
  }

  /** resolvedValue(in:) */
  resolvedValue(context: UISheetPresentationControllerDetentResolutionContext): number | null {
    const v = this.resolver(context);
    return v === null ? null : Math.max(0, Math.min(context.maximumDetentValue, v));
  }
}

export const UISheetPresentationControllerDetentIdentifier = {
  medium: 'com.apple.UIKit.medium',
  large: 'com.apple.UIKit.large',
} as const;

export interface UISheetPresentationControllerDelegate {
  sheetPresentationControllerDidChangeSelectedDetentIdentifier?(controller: UISheetPresentationController): void;
}

/** The presenter's card scale-back is slightly dimmed (iOS 26). */
const PRESENTER_DIM = 0.15;
const GRABBER = { width: 36, height: 5, top: 5 };

class GrabberView extends UIView {
  constructor() {
    super();
    this.isUserInteractionEnabled = false;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const b = this.bounds.size;
    const r = b.height / 2;
    const color = UIColor.tertiaryLabel.resolvedColor(this.traitCollection).rgba;
    ctx.item({ x: ctx.x, y: ctx.y, w: b.width, h: b.height }, (w) => w.fillRRect(ctx.x, ctx.y, b.width, b.height, [r, r, r, r], color));
  }
}

export class UISheetPresentationController extends UIPresentationController {
  private _detents: UISheetPresentationControllerDetent[] = [UISheetPresentationControllerDetent.large()];
  private _selected: string | null = null;
  prefersGrabberVisible = false;
  preferredCornerRadius: number | null = null;
  largestUndimmedDetentIdentifier: string | null = null;
  prefersScrollingExpandsWhenScrolledToEdge = true;
  prefersEdgeAttachedInCompactHeight = false;
  widthFollowsPreferredContentSizeWhenEdgeAttached = false;
  sheetDelegate: UISheetPresentationControllerDelegate | null = null;
  private readonly dimming = new UIView();
  private readonly presenterDim = new UIView();
  private readonly grabber = new GrabberView();
  private readonly pan: UIPanGestureRecognizer;
  private dragStart = 0;
  private presenterState: { view: UIView; clips: boolean; radius: number } | null = null;
  private windowBackground: UIColor | null = null;
  private shown = false;

  constructor(presented: UIViewController, presenting: UIViewController | null) {
    super(presented, presenting);
    this.dimming.backgroundColor = UIColor.black;
    this.dimming.alpha = 0;
    this.presenterDim.backgroundColor = UIColor.black;
    this.presenterDim.alpha = 0;
    this.presenterDim.isUserInteractionEnabled = false;
    this.dimming.addGestureRecognizer(new UITapGestureRecognizer(() => this.userDismiss()));
    this.pan = new UIPanGestureRecognizer((g) => this.handlePan(g));
    this.pan.delegate = {
      gestureRecognizerShouldBegin: () => this.panShouldBegin(),
      // A scroll view inside the sheet waits until the sheet decided whether the drag is its own.
      shouldBeRequiredToFailBy: (_me, other) => other instanceof UIScrollViewPanGestureRecognizer && !!other.view?.isDescendantOf(this.presentedView),
    };
  }

  // ── configuration ─────────────────────────────────────────────────────

  get detents(): readonly UISheetPresentationControllerDetent[] {
    return this._detents;
  }

  set detents(detents: readonly UISheetPresentationControllerDetent[]) {
    this._detents = detents.length ? [...detents] : [UISheetPresentationControllerDetent.large()];
    this.relayout();
  }

  /** null: the smallest detent */
  get selectedDetentIdentifier(): string | null {
    return this._selected;
  }

  set selectedDetentIdentifier(identifier: string | null) {
    this._selected = identifier;
    this.relayout();
  }

  /** animateChanges(_:) — detent changes made in the block animate. */
  animateChanges(changes: () => void): void {
    UIView.animate(PRESENTATION_SPRING, () => {
      changes();
      this._layout();
    });
  }

  private relayout(): void {
    if (this.shown) UIView.performWithoutAnimation(() => this._layout());
  }

  // ── geometry ──────────────────────────────────────────────────────────

  private get safeTop(): number {
    return this.window?.application?.screen.safeAreaInsets.top ?? 0;
  }

  private get containerHeight(): number {
    return this.containerView.bounds.size.height || this.window?.bounds.size.height || 0;
  }

  /** The tallest a sheet can be (the large detent). */
  private get maximumHeight(): number {
    return this.containerHeight - this.safeTop - (iosKit.tokens.sheetTopGap as number);
  }

  private resolvedDetents(): Array<{ id: string; height: number }> {
    const context = { maximumDetentValue: this.maximumHeight, containerTraitCollection: null };
    return this._detents
      .map((d) => ({ id: d.identifier, height: d.resolvedValue(context) }))
      .filter((d): d is { id: string; height: number } => d.height !== null)
      .sort((a, b) => a.height - b.height);
  }

  private get currentDetent(): { id: string; height: number } {
    const detents = this.resolvedDetents();
    return detents.find((d) => d.id === this._selected) ?? detents[0] ?? { id: UISheetPresentationControllerDetentIdentifier.large, height: this.maximumHeight };
  }

  private get cornerRadius(): number {
    return this.preferredCornerRadius ?? (iosKit.tokens.sheetRadius as number);
  }

  override get shouldRemovePresentersView(): boolean {
    return false;
  }

  override get frameOfPresentedViewInContainerView(): CGRect {
    const b = this.containerView.bounds.size;
    const h = this.currentDetent.height;
    return { origin: { x: 0, y: b.height - h }, size: { width: b.width, height: h } };
  }

  /** How far the presenter is scaled back (1 with the sheet at its large height, 0 at the next detent down). */
  private presenterProgress(sheetHeight: number): number {
    if (this.window?.application?.screen.traitCollection.userInterfaceIdiom !== 0) return 0;
    const detents = this.resolvedDetents();
    const largest = detents[detents.length - 1];
    if (!largest || largest.height < this.maximumHeight - 0.5) return 0;
    const below = detents.length > 1 ? detents[detents.length - 2]!.height : 0;
    if (detents.length === 1) return Math.max(0, Math.min(1, sheetHeight / largest.height));
    return Math.max(0, Math.min(1, (sheetHeight - below) / (largest.height - below)));
  }

  /** Dimming above the largest undimmed detent. */
  private dimAlpha(sheetHeight: number): number {
    const undimmed = this.largestUndimmedDetentIdentifier;
    const detents = this.resolvedDetents();
    if (!undimmed) {
      // Without scale-back (medium sheets), the area above the sheet dims.
      return this.presenterProgress(sheetHeight) > 0 ? 0 : Math.min(1, sheetHeight / (detents[0]?.height || 1)) * alphaOf(iosKit.tokens.sheetDim as number);
    }
    const limit = detents.find((d) => d.id === undimmed)?.height ?? 0;
    const above = detents.filter((d) => d.height > limit);
    if (!above.length || sheetHeight <= limit) return 0;
    return Math.min(1, (sheetHeight - limit) / (above[0]!.height - limit)) * alphaOf(iosKit.tokens.sheetDim as number);
  }

  // ── installation & layout ─────────────────────────────────────────────

  override _attach(window: UIWindow, entry: PresentedEntry): void {
    super._attach(window, entry);
    this.containerView.insertSubview(this.dimming, 0);
    this.presentedView.addGestureRecognizer(this.pan);
    this.presentedView.layer.maskedCorners = 1 | 2;
    this.presentedView.clipsToBounds = true;
    if (this.prefersGrabberVisible) this.presentedView.addSubview(this.grabber);
  }

  override _layout(): void {
    super._layout();
    const b = this.containerView.bounds;
    this.dimming.frame = b;
    const view = this.presentedView;
    view.layer.cornerRadius = this.cornerRadius;
    if (this.prefersGrabberVisible) {
      if (this.grabber.superview !== view) view.addSubview(this.grabber);
      view.bringSubviewToFront(this.grabber);
      this.grabber.frame = { origin: { x: (b.size.width - GRABBER.width) / 2, y: GRABBER.top }, size: { width: GRABBER.width, height: GRABBER.height } };
    } else if (this.grabber.superview) this.grabber.removeFromSuperview();
    if (this.shown) this.applyProgress(this.currentDetent.height);
  }

  /** Presenter scale-back, dimming and status bar for a sheet `height` tall. */
  private applyProgress(height: number): void {
    const p = this.presenterProgress(height);
    this.dimming.alpha = this.dimAlpha(height);
    const presenter = this.presenterView();
    if (presenter && (p > 0 || this.presenterState)) {
      if (!this.presenterState) {
        this.presenterState = { view: presenter, clips: presenter.clipsToBounds, radius: presenter.layer.cornerRadius };
        UIView.performWithoutAnimation(() => {
          presenter.clipsToBounds = true;
          if (this.window) {
            this.windowBackground = this.window.backgroundColor;
            this.window.backgroundColor = UIColor.black;
          }
          presenter.addSubview(this.presenterDim);
          this.presenterDim.frame = presenter.bounds;
        });
      }
      const width = this.containerView.bounds.size.width;
      const scale = 1 - (1 - (iosKit.tokens.pageSheetScale as number)) * p;
      const dy = (this.safeTop - 10) * p;
      // Scaled about the top center, then moved down under the status bar.
      const m = multiply(translation(width / 2, dy), multiply(scaling(scale, scale), translation(-width / 2, 0)));
      // UIView transforms apply about the center: convert from top-left-based.
      const h = presenter.bounds.size.height;
      const cx = width / 2;
      const cy = h / 2;
      const about = multiply(translation(-cx, -cy), multiply(m, translation(cx, cy)));
      presenter.transform = fromMatrix(about);
      presenter.layer.cornerRadius = this.cornerRadius * p;
      this.presenterDim.alpha = PRESENTER_DIM * p;
    }
    const app = this.window?.application;
    if (app) {
      const light = p > 0.5 ? 'light-content' : null;
      if (app._systemStatusBarStyle !== light) {
        app._systemStatusBarStyle = light;
        app.statusBarAppearanceChanged();
      }
    }
  }

  private restorePresenter(): void {
    const s = this.presenterState;
    if (!s) return;
    this.presenterState = null;
    UIView.performWithoutAnimation(() => {
      s.view.transform = CGAffineTransformIdentity;
      s.view.layer.cornerRadius = s.radius;
    });
    s.view.clipsToBounds = s.clips;
    this.presenterDim.removeFromSuperview();
    if (this.window) this.window.backgroundColor = this.windowBackground;
    const app = this.window?.application;
    if (app && app._systemStatusBarStyle) {
      app._systemStatusBarStyle = null;
      app.statusBarAppearanceChanged();
    }
  }

  // ── transitions ───────────────────────────────────────────────────────

  override _present(animated: boolean, done: () => void): void {
    this.presentationTransitionWillBegin();
    UIView.performWithoutAnimation(() => this._layout());
    const view = this.presentedView;
    const height = this.currentDetent.height;
    const finish = () => {
      this.presentationTransitionDidEnd(true);
      done();
    };
    this.shown = true;
    if (!animated) {
      UIView.performWithoutAnimation(() => this.applyProgress(height));
      finish();
      return;
    }
    UIView.performWithoutAnimation(() => {
      view.transform = CGAffineTransformMakeTranslation(0, height);
      this.applyProgress(0);
    });
    UIView.animate(PRESENTATION_SPRING, () => {
      view.transform = CGAffineTransformIdentity;
      this.applyProgress(height);
    }, finish);
  }

  override _dismiss(animated: boolean, done: () => void): void {
    this.dismissalTransitionWillBegin();
    const view = this.presentedView;
    const finish = () => {
      this.shown = false;
      this.restorePresenter();
      this.dismissalTransitionDidEnd(true);
      done();
    };
    if (!animated) {
      finish();
      return;
    }
    UIView.animate(PRESENTATION_SPRING, () => {
      view.transform = CGAffineTransformMakeTranslation(0, view.bounds.size.height);
      this.applyProgress(0);
    }, finish);
  }

  // ── dragging ──────────────────────────────────────────────────────────

  private scrollViewUnder(point: CGPoint): UIScrollView | null {
    const view = this.presentedView;
    for (let v: UIView | null = view.hitTest(view.convertPointFrom(point, null), null); v && v !== view.superview; v = v.superview) {
      if (v instanceof UIScrollView && !v.horizontal) return v;
    }
    return null;
  }

  private panShouldBegin(): boolean {
    const touch = Array.from(this.pan._touches)[0];
    if (!touch) return false;
    const t = this.pan.translation(null);
    if (Math.abs(t.x) > Math.abs(t.y)) return false;
    const scroll = this.scrollViewUnder({ x: touch.startX, y: touch.startY });
    if (!scroll) return true;
    const atTop = scroll.contentOffset.y <= -scroll.adjustedContentInset.top + 0.5;
    const detents = this.resolvedDetents();
    const expandable = this.prefersScrollingExpandsWhenScrolledToEdge && this.currentDetent.height < (detents[detents.length - 1]?.height ?? 0);
    return t.y > 0 ? atTop : expandable;
  }

  private handlePan(g: UIGestureRecognizer): void {
    const S = UIGestureRecognizerState;
    const pan = g as UIPanGestureRecognizer;
    const view = this.presentedView;
    const base = this.currentDetent.height;
    const max = this.resolvedDetents().at(-1)?.height ?? base;
    switch (pan.state) {
      case S.began:
        this.dragStart = view.transform.ty;
        break;
      case S.changed: {
        const dy = pan.translation(null).y + this.dragStart;
        // Above the largest detent the sheet resists (rubber band).
        let offset = dy;
        const room = base - max;
        if (dy < room) offset = room - Math.sqrt(room - dy) * 2;
        UIView.performWithoutAnimation(() => {
          view.transform = CGAffineTransformMakeTranslation(0, offset);
          this.applyProgress(base - offset);
        });
        break;
      }
      case S.ended:
      case S.cancelled:
        this.release(pan.velocity(null).y);
        break;
    }
  }

  private release(velocity: number): void {
    const view = this.presentedView;
    const height = this.currentDetent.height - view.transform.ty;
    const detents = this.resolvedDetents();
    // Where the flick would carry it, then the nearest stop (or off the bottom).
    const projected = height - velocity * 0.15;
    const smallest = detents[0]!.height;
    const dismissing = projected < smallest * (2 / 3) || (velocity > 1000 && height < smallest + 1);
    if (dismissing) {
      if (this.presentedViewController.isModalInPresentation || this.delegate?.presentationControllerShouldDismiss?.(this) === false) {
        this.delegate?.presentationControllerDidAttemptToDismiss?.(this);
      } else {
        this.userDismiss();
        return;
      }
    }
    let best = detents[0]!;
    for (const d of detents) if (Math.abs(d.height - projected) < Math.abs(best.height - projected)) best = d;
    const changed = best.id !== this.currentDetent.id;
    this._selected = best.id;
    UIView.animate(PRESENTATION_SPRING, () => {
      view.transform = CGAffineTransformIdentity;
      this._layout();
      this.applyProgress(best.height);
    });
    if (changed) this.sheetDelegate?.sheetPresentationControllerDidChangeSelectedDetentIdentifier?.(this);
  }

  /** A swipe or a tap outside dismisses (asking the delegate first). */
  private userDismiss(): void {
    if (this.presentedViewController.isModalInPresentation || this.delegate?.presentationControllerShouldDismiss?.(this) === false) {
      this.delegate?.presentationControllerDidAttemptToDismiss?.(this);
      return;
    }
    this.delegate?.presentationControllerWillDismiss?.(this);
    this.presentingViewController.dismiss(true, () => this.delegate?.presentationControllerDidDismiss?.(this));
  }
}
