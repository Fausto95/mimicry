import type { UIView } from './ui-view';
import type { UIViewController } from './ui-view-controller';
import type { UIWindow } from './ui-window';

/**
 * Modal presentation in a window: presented view controllers' views stack
 * above the root view controller's view, each in its own container (UIKit's
 * UITransitionView). Transition animations and sheet styles are layered on
 * by the presentation controllers (see presentation-controllers.ts).
 */
export interface PresentedEntry {
  presenting: UIViewController;
  presented: UIViewController;
  container: UIView;
}

export class Presentation {
  readonly stack: PresentedEntry[] = [];
  /** installed by the transition machinery; default is an immediate, unanimated swap */
  transitions: PresentationTransitions = immediateTransitions;

  constructor(private readonly window: UIWindow) {}

  present(presenting: UIViewController, presented: UIViewController, animated: boolean, completion?: () => void): void {
    if (presenting._presentedViewController) {
      throw new Error('UIViewController.present: the view controller is already presenting');
    }
    // UIKit presents from the topmost presented controller in the context.
    presenting._presentedViewController = presented;
    presented._presentingViewController = presenting;
    const container = this.transitions.makeContainer(this.window, presented);
    this.window.addSubview(container);
    const entry: PresentedEntry = { presenting, presented, container };
    this.stack.push(entry);
    presented.viewWillAppear(animated);
    this.transitions.present(this.window, entry, animated, () => {
      presented.viewDidAppear(animated);
      completion?.();
    });
  }

  dismiss(presenting: UIViewController, animated: boolean, completion?: () => void): void {
    const at = this.stack.findIndex((e) => e.presenting === presenting);
    if (at < 0) {
      completion?.();
      return;
    }
    // Dismissing a presenter also dismisses everything above it.
    const removed = this.stack.splice(at);
    for (const entry of removed.slice(1).reverse()) this.finishDismiss(entry);
    const entry = removed[0]!;
    entry.presented.viewWillDisappear(animated);
    this.transitions.dismiss(this.window, entry, animated, () => {
      this.finishDismiss(entry);
      completion?.();
    });
  }

  private finishDismiss(entry: PresentedEntry): void {
    entry.container.removeFromSuperview();
    entry.presenting._presentedViewController = null;
    entry.presented._presentingViewController = null;
    entry.presented.viewDidDisappear(false);
  }

  /** Window layout: containers fill the window (presentation controllers may inset them). */
  layout(): void {
    for (const entry of this.stack) this.transitions.layout(this.window, entry);
  }

  get topViewController(): UIViewController | null {
    return this.stack[this.stack.length - 1]?.presented ?? this.window.rootViewController;
  }
}

export interface PresentationTransitions {
  makeContainer(window: UIWindow, presented: UIViewController): UIView;
  present(window: UIWindow, entry: PresentedEntry, animated: boolean, done: () => void): void;
  dismiss(window: UIWindow, entry: PresentedEntry, animated: boolean, done: () => void): void;
  layout(window: UIWindow, entry: PresentedEntry): void;
}

const immediateTransitions: PresentationTransitions = {
  makeContainer(_window, presented) {
    return presented.view;
  },
  present(window, entry, _animated, done) {
    entry.container.frame = window.bounds;
    done();
  },
  dismiss(_window, _entry, _animated, done) {
    done();
  },
  layout(window, entry) {
    entry.container.frame = window.bounds;
  },
};
