import type { UIView } from './ui-view';
import type { UIViewController } from './ui-view-controller';
import type { UIWindow } from './ui-window';

/**
 * Modal presentation in a window: presented view controllers' views stack
 * above the root view controller's view, each in its own container
 * (UIKit's UITransitionView) that its presentation controller arranges —
 * full screen, over full screen, cross dissolve, page / form sheets (see
 * ui-presentation-controller.ts and ui-sheet-presentation-controller.ts).
 *
 * Appearance callbacks follow UIKit: the presented controller always gets
 * will/didAppear; the presenter gets will/didDisappear only when the
 * presentation removes its view (full screen), and the reverse on dismissal.
 */
export interface PresentedEntry {
  presenting: UIViewController;
  presented: UIViewController;
  container: UIView;
  controller: PresentationControllerLike;
}

/** What Presentation needs from a presentation controller. */
export interface PresentationControllerLike {
  readonly containerView: UIView;
  /** the presenter's view goes away while presented (full screen) */
  readonly shouldRemovePresentersView: boolean;
  _attach(window: UIWindow, entry: PresentedEntry): void;
  _present(animated: boolean, done: () => void): void;
  _dismiss(animated: boolean, done: () => void): void;
  _layout(): void;
  _finished(): void;
}

export interface PresentationTransitions {
  present(window: UIWindow, entry: PresentedEntry, animated: boolean, done: () => void): void;
  dismiss(window: UIWindow, entry: PresentedEntry, animated: boolean, done: () => void): void;
  layout(window: UIWindow, entry: PresentedEntry): void;
}

/** UIKit's transitions: whatever the entry's presentation controller does. */
export const uikitTransitions: PresentationTransitions = {
  present(_window, entry, animated, done) {
    entry.controller._present(animated, done);
  },
  dismiss(_window, entry, animated, done) {
    entry.controller._dismiss(animated, done);
  },
  layout(_window, entry) {
    entry.controller._layout();
  },
};

/** No animation at all: the presented view fills the window at once. */
export const immediateTransitions: PresentationTransitions = {
  present(window, entry, _animated, done) {
    entry.container.frame = window.bounds;
    entry.presented.view.frame = window.bounds;
    done();
  },
  dismiss(_window, _entry, _animated, done) {
    done();
  },
  layout(window, entry) {
    entry.container.frame = window.bounds;
    entry.presented.view.frame = window.bounds;
  },
};

export class Presentation {
  readonly stack: PresentedEntry[] = [];
  transitions: PresentationTransitions = uikitTransitions;

  constructor(private readonly window: UIWindow) {}

  present(presenting: UIViewController, presented: UIViewController, animated: boolean, completion?: () => void): void {
    // UIKit presents from the top of the presentation chain.
    let from = presenting;
    while (from._presentedViewController) from = from._presentedViewController;
    if (presented._presentingViewController) throw new Error('UIViewController.present: the view controller is already presented');
    from._presentedViewController = presented;
    presented._presentingViewController = from;
    const controller = presented._makePresentationController(from);
    const entry: PresentedEntry = { presenting: from, presented, container: controller.containerView, controller };
    this.window.addSubview(entry.container);
    controller._attach(this.window, entry);
    this.stack.push(entry);
    const removes = controller.shouldRemovePresentersView;
    presented._isBeingPresented = true;
    if (removes) from.viewWillDisappear(animated);
    presented.viewWillAppear(animated);
    this.transitions.present(this.window, entry, animated, () => {
      presented._isBeingPresented = false;
      presented.viewDidAppear(animated);
      if (removes) from.viewDidDisappear(animated);
      completion?.();
    });
  }

  dismiss(presenting: UIViewController, animated: boolean, completion?: () => void): void {
    const at = this.stack.findIndex((e) => e.presenting === presenting);
    if (at < 0) {
      completion?.();
      return;
    }
    // Dismissing a presenter also dismisses everything above it, at once.
    const removed = this.stack.splice(at);
    for (const entry of removed.slice(1).reverse()) this.finishDismiss(entry, false);
    const entry = removed[0]!;
    const removes = entry.controller.shouldRemovePresentersView;
    entry.presented._isBeingDismissed = true;
    entry.presented.viewWillDisappear(animated);
    if (removes) entry.presenting.viewWillAppear(animated);
    this.transitions.dismiss(this.window, entry, animated, () => {
      this.finishDismiss(entry, animated);
      if (removes) entry.presenting.viewDidAppear(animated);
      completion?.();
    });
  }

  private finishDismiss(entry: PresentedEntry, animated: boolean): void {
    entry.container.removeFromSuperview();
    entry.presenting._presentedViewController = null;
    entry.presented._presentingViewController = null;
    entry.presented._isBeingDismissed = false;
    entry.presented.viewDidDisappear(animated);
    entry.controller._finished();
  }

  /** Window layout: each presentation controller places its views. */
  layout(): void {
    for (const entry of this.stack) this.transitions.layout(this.window, entry);
  }

  get topViewController(): UIViewController | null {
    return this.stack[this.stack.length - 1]?.presented ?? this.window.rootViewController;
  }

  /** The entry presenting `vc`, if it is presented. */
  entryFor(vc: UIViewController): PresentedEntry | null {
    return this.stack.find((e) => e.presented === vc) ?? null;
  }
}
