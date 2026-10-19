import type { Context } from '../content/context';
import { MaterialMotion, type TimeInterpolator } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { LayoutParams, View } from '../view/view';
import { FrameLayout, type ViewGroup } from '../view/view-group';
import { OnBackPressedCallback, type Activity } from './activity';

/**
 * androidx.fragment: Fragment, FragmentManager, FragmentTransaction and
 * FragmentContainerView.
 *
 * Fragments move through the androidx lifecycle (onAttach → onCreate →
 * onCreateView → onViewCreated → onStart → onResume, and back down through
 * onPause → onStop → onDestroyView → onDestroy → onDetach), never further
 * than their activity. Transactions commit asynchronously (after the
 * current task, like a posted message) unless committed with commitNow;
 * transactions added to the back stack are reversed by popBackStack, which
 * the activity's OnBackPressedDispatcher calls while the stack is not empty.
 *
 * Custom animations are descriptions (FragmentAnimation): the Material
 * motion presets — fade through and shared axis (MaterialFadeThrough /
 * MaterialSharedAxis) — or your own. Removed views stay until their exit
 * animation ends.
 */
export const FragmentState = {
  INITIALIZING: -1,
  ATTACHED: 0,
  CREATED: 1,
  VIEW_CREATED: 2,
  STARTED: 5,
  RESUMED: 7,
} as const;

/** A view property animation: from → to, over a duration with an easing. */
export interface FragmentAnimation {
  duration: number;
  /** delay before it starts, ms */
  startDelay?: number;
  interpolator: TimeInterpolator;
  from: AnimatedProps;
  to: AnimatedProps;
}

export interface AnimatedProps {
  alpha?: number;
  /** dp */
  translationX?: number;
  translationY?: number;
  scale?: number;
}

/**
 * Material motion transitions (com.google.android.material.transition):
 * fade through, and shared axis along X, Y or Z, each with an enter and
 * exit side, 300 ms with M3's emphasized easing. The incoming view fades in
 * after the outgoing one fades out (the first 35 % of the duration).
 */
export const MaterialTransitions = {
  fadeThroughEnter: (): FragmentAnimation => ({
    duration: MaterialMotion.duration.medium2, startDelay: 105, interpolator: MaterialMotion.easing.emphasizedDecelerate,
    from: { alpha: 0, scale: 0.92 }, to: { alpha: 1, scale: 1 },
  }),
  fadeThroughExit: (): FragmentAnimation => ({
    duration: 105, interpolator: MaterialMotion.easing.emphasizedAccelerate,
    from: { alpha: 1 }, to: { alpha: 0 },
  }),
  /** Shared axis: `forward` moves toward the end (or down / in for Y / Z). */
  sharedAxisEnter: (axis: 'x' | 'y' | 'z', forward: boolean): FragmentAnimation => ({
    duration: MaterialMotion.duration.medium2, interpolator: MaterialMotion.easing.emphasized,
    from: { alpha: 0, ...axisOffset(axis, forward ? 1 : -1, 'enter') }, to: { alpha: 1, translationX: 0, translationY: 0, scale: 1 },
  }),
  sharedAxisExit: (axis: 'x' | 'y' | 'z', forward: boolean): FragmentAnimation => ({
    duration: MaterialMotion.duration.medium2, interpolator: MaterialMotion.easing.emphasized,
    from: { alpha: 1, translationX: 0, translationY: 0, scale: 1 }, to: { alpha: 0, ...axisOffset(axis, forward ? -1 : 1, 'exit') },
  }),
  fadeIn: (): FragmentAnimation => ({ duration: 150, interpolator: MaterialMotion.easing.linear, from: { alpha: 0 }, to: { alpha: 1 } }),
  fadeOut: (): FragmentAnimation => ({ duration: 150, interpolator: MaterialMotion.easing.linear, from: { alpha: 1 }, to: { alpha: 0 } }),
};

function axisOffset(axis: 'x' | 'y' | 'z', sign: number, side: 'enter' | 'exit'): AnimatedProps {
  // MDC SlideDistanceProvider: 30 dp; ScaleProvider for Z: 0.8 / 1.1
  if (axis === 'x') return { translationX: 30 * sign };
  if (axis === 'y') return { translationY: 30 * sign };
  return { scale: side === 'enter' ? (sign > 0 ? 0.8 : 1.1) : sign > 0 ? 1.1 : 0.8 };
}

/** The four animations of setCustomAnimations, or the preset of a TRANSIT_FRAGMENT_* transition. */
interface Animations {
  enter: FragmentAnimation | null;
  exit: FragmentAnimation | null;
  popEnter: FragmentAnimation | null;
  popExit: FragmentAnimation | null;
}

/** android.view.LayoutInflater, reduced to what onCreateView receives. */
export class LayoutInflater {
  constructor(private readonly context: Context) {}
  static from(context: Context): LayoutInflater {
    return new LayoutInflater(context);
  }
  getContext(): Context {
    return this.context;
  }
}

export type Bundle = Record<string, unknown>;

let nextFragmentWho = 1;

export class Fragment {
  /** @internal */
  state: number = FragmentState.INITIALIZING;
  /** @internal */
  manager: FragmentManager | null = null;
  /** @internal */
  containerId = View.NO_ID;
  /** @internal */
  tag: string | null = null;
  /** @internal */
  hidden = false;
  /** @internal */
  removing = false;
  /** @internal */
  readonly who = `fragment-${nextFragmentWho++}`;
  private view: View | null = null;
  private args: Bundle | null = null;
  private childManager: FragmentManager | null = null;
  private enterTransition: FragmentAnimation | null = null;
  private exitTransition: FragmentAnimation | null = null;
  private reenterTransition: FragmentAnimation | null = null;
  private returnTransition: FragmentAnimation | null = null;

  // ── lifecycle callbacks (override these) ────────────────────────────

  onAttach(_context: Context): void {}
  onCreate(_savedInstanceState: Bundle | null): void {}
  onCreateView(_inflater: LayoutInflater, _container: ViewGroup | null, _savedInstanceState: Bundle | null): View | null {
    return null;
  }
  onViewCreated(_view: View, _savedInstanceState: Bundle | null): void {}
  onStart(): void {}
  onResume(): void {}
  onPause(): void {}
  onStop(): void {}
  onDestroyView(): void {}
  onDestroy(): void {}
  onDetach(): void {}
  onHiddenChanged(_hidden: boolean): void {}

  // ── accessors ───────────────────────────────────────────────────────

  getView(): View | null {
    return this.view;
  }

  requireView(): View {
    if (!this.view) throw new Error(`IllegalStateException: Fragment ${this} did not return a View from onCreateView() or this was called before onCreateView().`);
    return this.view;
  }

  getActivity(): Activity | null {
    return this.manager?.host ?? null;
  }

  requireActivity(): Activity {
    const a = this.getActivity();
    if (!a) throw new Error(`IllegalStateException: Fragment ${this} not attached to an activity.`);
    return a;
  }

  getContext(): Context | null {
    return this.getActivity();
  }

  requireContext(): Context {
    return this.requireActivity();
  }

  getParentFragmentManager(): FragmentManager {
    if (!this.manager) throw new Error(`IllegalStateException: Fragment ${this} not associated with a fragment manager.`);
    return this.manager;
  }

  /** @deprecated in androidx: getParentFragmentManager() */
  getFragmentManager(): FragmentManager | null {
    return this.manager;
  }

  getChildFragmentManager(): FragmentManager {
    if (!this.childManager) {
      const activity = this.requireActivity();
      this.childManager = new FragmentManager(activity, this);
    }
    return this.childManager;
  }

  getArguments(): Bundle | null {
    return this.args;
  }

  requireArguments(): Bundle {
    if (!this.args) throw new Error(`IllegalStateException: Fragment ${this} does not have any arguments.`);
    return this.args;
  }

  setArguments(args: Bundle | null): void {
    if (this.manager && this.state >= FragmentState.ATTACHED) throw new Error('IllegalStateException: Fragment already added and state has been saved');
    this.args = args;
  }

  getTag(): string | null {
    return this.tag;
  }

  getId(): number {
    return this.containerId;
  }

  isAdded(): boolean {
    return this.manager !== null && !this.removing && this.state >= FragmentState.ATTACHED;
  }

  isRemoving(): boolean {
    return this.removing;
  }

  isHidden(): boolean {
    return this.hidden;
  }

  isVisible(): boolean {
    return this.isAdded() && !this.hidden && !!this.view && this.view.isAttachedToWindow() && this.view.getVisibility() === View.VISIBLE;
  }

  isResumed(): boolean {
    return this.state >= FragmentState.RESUMED;
  }

  getLifecycleState(): number {
    return this.state;
  }

  setEnterTransition(t: FragmentAnimation | null): void { this.enterTransition = t; }
  setExitTransition(t: FragmentAnimation | null): void { this.exitTransition = t; }
  setReenterTransition(t: FragmentAnimation | null): void { this.reenterTransition = t; }
  setReturnTransition(t: FragmentAnimation | null): void { this.returnTransition = t; }

  /** @internal the transition for an operation, the fragment's own taking precedence */
  transitionFor(kind: 'enter' | 'exit' | 'popEnter' | 'popExit'): FragmentAnimation | null {
    switch (kind) {
      case 'enter': return this.enterTransition;
      case 'exit': return this.exitTransition;
      case 'popEnter': return this.reenterTransition ?? this.enterTransition;
      case 'popExit': return this.returnTransition ?? this.exitTransition;
    }
  }

  /** @internal set by the manager around onCreateView */
  setViewInternal(view: View | null): void {
    this.view = view;
  }

  /** @internal */
  get children(): FragmentManager | null {
    return this.childManager;
  }

  toString(): string {
    return `${this.constructor.name}{${this.who}${this.tag ? ` tag=${this.tag}` : ''}}`;
  }
}

/** androidx.fragment.app.FragmentContainerView: the FrameLayout fragments' views go into. */
export class FragmentContainerView extends FrameLayout {
  constructor(context: Context, id = View.generateViewId()) {
    super(context);
    this.setId(id);
  }

  /** The fragment whose view is on top. */
  getFragment<T extends Fragment = Fragment>(): T | null {
    const manager = (this.context as Activity).getSupportFragmentManager?.();
    return (manager?.findFragmentById(this.getId()) as T | null) ?? null;
  }
}

type Op =
  | { cmd: 'add'; fragment: Fragment; containerId: number; tag: string | null }
  | { cmd: 'replace'; fragment: Fragment; containerId: number; tag: string | null; removed: Fragment[] }
  | { cmd: 'remove'; fragment: Fragment }
  | { cmd: 'show'; fragment: Fragment }
  | { cmd: 'hide'; fragment: Fragment }
  | { cmd: 'detach'; fragment: Fragment }
  | { cmd: 'attach'; fragment: Fragment };

export interface BackStackEntry {
  getId(): number;
  getName(): string | null;
}

export class FragmentTransaction implements BackStackEntry {
  static readonly TRANSIT_NONE = 0;
  static readonly TRANSIT_FRAGMENT_OPEN = 0x1001;
  static readonly TRANSIT_FRAGMENT_CLOSE = 0x2002;
  static readonly TRANSIT_FRAGMENT_FADE = 0x1003;
  static readonly TRANSIT_FRAGMENT_MATCH_ACTIVITY_OPEN = 0x1004;
  static readonly TRANSIT_FRAGMENT_MATCH_ACTIVITY_CLOSE = 0x2005;

  /** @internal */
  readonly ops: Op[] = [];
  /** @internal */
  animations: Animations = { enter: null, exit: null, popEnter: null, popExit: null };
  /** @internal */
  addToStack = false;
  /** @internal */
  name: string | null = null;
  private committed = false;
  private reordering = false;
  /** @internal */
  index = -1;

  constructor(private readonly manager: FragmentManager) {}

  getId(): number {
    return this.index;
  }

  getName(): string | null {
    return this.name;
  }

  add(containerIdOrFragment: number | Fragment, fragmentOrTag?: Fragment | string | null, tag: string | null = null): this {
    if (typeof containerIdOrFragment === 'number') {
      this.ops.push({ cmd: 'add', fragment: fragmentOrTag as Fragment, containerId: containerIdOrFragment, tag });
    } else {
      this.ops.push({ cmd: 'add', fragment: containerIdOrFragment, containerId: View.NO_ID, tag: (fragmentOrTag as string | null | undefined) ?? null });
    }
    return this;
  }

  replace(containerId: number, fragment: Fragment, tag: string | null = null): this {
    this.ops.push({ cmd: 'replace', fragment, containerId, tag, removed: [] });
    return this;
  }

  remove(fragment: Fragment): this {
    this.ops.push({ cmd: 'remove', fragment });
    return this;
  }

  show(fragment: Fragment): this {
    this.ops.push({ cmd: 'show', fragment });
    return this;
  }

  hide(fragment: Fragment): this {
    this.ops.push({ cmd: 'hide', fragment });
    return this;
  }

  detach(fragment: Fragment): this {
    this.ops.push({ cmd: 'detach', fragment });
    return this;
  }

  attach(fragment: Fragment): this {
    this.ops.push({ cmd: 'attach', fragment });
    return this;
  }

  addToBackStack(name: string | null): this {
    this.addToStack = true;
    this.name = name;
    return this;
  }

  isAddToBackStackAllowed(): boolean {
    return true;
  }

  setReorderingAllowed(allowed: boolean): this {
    this.reordering = allowed;
    return this;
  }

  getReorderingAllowed(): boolean {
    return this.reordering;
  }

  setCustomAnimations(enter: FragmentAnimation | null, exit: FragmentAnimation | null, popEnter: FragmentAnimation | null = null, popExit: FragmentAnimation | null = null): this {
    this.animations = { enter, exit, popEnter, popExit };
    return this;
  }

  /** A standard transition: OPEN/CLOSE use the Material shared X axis, FADE fades. */
  setTransition(transit: number): this {
    switch (transit) {
      case FragmentTransaction.TRANSIT_FRAGMENT_OPEN:
      case FragmentTransaction.TRANSIT_FRAGMENT_MATCH_ACTIVITY_OPEN:
        this.animations = {
          enter: MaterialTransitions.sharedAxisEnter('x', true), exit: MaterialTransitions.sharedAxisExit('x', true),
          popEnter: MaterialTransitions.sharedAxisEnter('x', false), popExit: MaterialTransitions.sharedAxisExit('x', false),
        };
        break;
      case FragmentTransaction.TRANSIT_FRAGMENT_CLOSE:
      case FragmentTransaction.TRANSIT_FRAGMENT_MATCH_ACTIVITY_CLOSE:
        this.animations = {
          enter: MaterialTransitions.sharedAxisEnter('x', false), exit: MaterialTransitions.sharedAxisExit('x', false),
          popEnter: MaterialTransitions.sharedAxisEnter('x', true), popExit: MaterialTransitions.sharedAxisExit('x', true),
        };
        break;
      case FragmentTransaction.TRANSIT_FRAGMENT_FADE:
        this.animations = { enter: MaterialTransitions.fadeIn(), exit: MaterialTransitions.fadeOut(), popEnter: MaterialTransitions.fadeIn(), popExit: MaterialTransitions.fadeOut() };
        break;
      default:
        this.animations = { enter: null, exit: null, popEnter: null, popExit: null };
    }
    return this;
  }

  setPrimaryNavigationFragment(_fragment: Fragment | null): this {
    return this;
  }

  private checkNotCommitted(): void {
    if (this.committed) throw new Error('IllegalStateException: commit already called');
    this.committed = true;
  }

  /** Schedule the transaction (it runs after the current task). Returns the back stack id or -1. */
  commit(): number {
    this.checkNotCommitted();
    return this.manager.enqueue(this);
  }

  commitAllowingStateLoss(): number {
    return this.commit();
  }

  /** Run the transaction now; it cannot be added to the back stack. */
  commitNow(): void {
    if (this.addToStack) throw new Error('IllegalStateException: This transaction is already being added to the back stack');
    this.checkNotCommitted();
    this.manager.executeNow(this);
  }

  commitNowAllowingStateLoss(): void {
    this.commitNow();
  }
}

export interface FragmentLifecycleListener {
  onBackStackChanged(): void;
}

export class FragmentManager {
  static readonly POP_BACK_STACK_INCLUSIVE = 1;

  private readonly added: Fragment[] = [];
  private readonly backStack: FragmentTransaction[] = [];
  private readonly pending: FragmentTransaction[] = [];
  private readonly stackListeners: Array<() => void> = [];
  private scheduled = false;
  private executing = false;
  private nextIndex = 0;
  private readonly backCallback: OnBackPressedCallback;
  private keepCreated = false;
  /** the state fragments may reach (the activity's, or the parent fragment's) */
  private hostState: number = FragmentState.INITIALIZING;

  constructor(readonly host: Activity, private readonly parent: Fragment | null = null) {
    this.backCallback = new OnBackPressedCallback(false, () => this.popBackStack());
    host.getOnBackPressedDispatcher().addCallback(this.backCallback);
    if (parent) this.hostState = parent.state;
  }

  beginTransaction(): FragmentTransaction {
    return new FragmentTransaction(this);
  }

  // ── queries ─────────────────────────────────────────────────────────

  getFragments(): Fragment[] {
    return this.added.slice();
  }

  findFragmentById(id: number): Fragment | null {
    for (let i = this.added.length - 1; i >= 0; i--) if (this.added[i]!.containerId === id) return this.added[i]!;
    return null;
  }

  findFragmentByTag(tag: string): Fragment | null {
    for (let i = this.added.length - 1; i >= 0; i--) if (this.added[i]!.tag === tag) return this.added[i]!;
    return null;
  }

  getBackStackEntryCount(): number {
    return this.backStack.length;
  }

  getBackStackEntryAt(index: number): BackStackEntry {
    const entry = this.backStack[index];
    if (!entry) throw new Error(`IndexOutOfBoundsException: ${index}`);
    return entry;
  }

  addOnBackStackChangedListener(listener: () => void): void {
    this.stackListeners.push(listener);
  }

  removeOnBackStackChangedListener(listener: () => void): void {
    const at = this.stackListeners.indexOf(listener);
    if (at >= 0) this.stackListeners.splice(at, 1);
  }

  isDestroyed(): boolean {
    return this.hostState === -2;
  }

  // ── executing ───────────────────────────────────────────────────────

  /** @internal */
  enqueue(tx: FragmentTransaction): number {
    this.pending.push(tx);
    if (tx.addToStack) tx.index = this.nextIndex++;
    this.schedule();
    return tx.addToStack ? tx.index : -1;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const kernel = this.host.kernel;
    kernel.defer(() => {
      this.scheduled = false;
      this.executePendingTransactions();
    });
    // the transaction changes what is on screen: make sure a frame (and the queue) runs
    kernel.requestFrame();
  }

  /** Run every committed transaction now. Returns true when there were any. */
  executePendingTransactions(): boolean {
    if (this.executing) return false;
    let ran = false;
    this.executing = true;
    try {
      while (this.pending.length) {
        const tx = this.pending.shift()!;
        this.apply(tx, false);
        if (tx.addToStack) {
          this.backStack.push(tx);
          this.stackChanged();
        }
        ran = true;
      }
    } finally {
      this.executing = false;
    }
    return ran;
  }

  /** @internal */
  executeNow(tx: FragmentTransaction): void {
    this.executePendingTransactions();
    this.executing = true;
    try {
      this.apply(tx, false);
    } finally {
      this.executing = false;
    }
  }

  private stackChanged(): void {
    this.backCallback.isEnabled = this.backStack.length > 0;
    for (const l of this.stackListeners.slice()) l();
  }

  /** Reverse the top back stack entry (asynchronously). */
  popBackStack(name: string | null = null, flags = 0): void {
    this.host.kernel.defer(() => this.popBackStackImmediate(name, flags));
    this.host.kernel.requestFrame();
  }

  /** Reverse back stack entries now: the top one, or down to `name` (inclusive with POP_BACK_STACK_INCLUSIVE). */
  popBackStackImmediate(name: string | null = null, flags = 0): boolean {
    this.executePendingTransactions();
    if (!this.backStack.length) return false;
    let count = 1;
    if (name !== null) {
      let at = -1;
      for (let i = this.backStack.length - 1; i >= 0; i--) {
        if (this.backStack[i]!.name === name) {
          at = i;
          break;
        }
      }
      if (at < 0) return false;
      count = this.backStack.length - at - (flags & FragmentManager.POP_BACK_STACK_INCLUSIVE ? 0 : 1);
      if (count <= 0) return false;
    }
    for (let i = 0; i < count; i++) {
      const tx = this.backStack.pop()!;
      this.apply(tx, true);
    }
    this.stackChanged();
    return true;
  }

  // ── operations ──────────────────────────────────────────────────────

  private apply(tx: FragmentTransaction, pop: boolean): void {
    const ops = pop ? tx.ops.slice().reverse() : tx.ops;
    const anim = tx.animations;
    // Fragments a back-stack transaction removes stay created (their views go) until the stack pops.
    this.keepCreated = tx.addToStack && !pop;
    for (const op of ops) {
      const f = op.fragment;
      switch (op.cmd) {
        case 'add':
          if (pop) this.removeFragment(f, anim.popExit, 'popExit');
          else this.addFragment(f, op.containerId, op.tag, anim.enter, 'enter');
          break;
        case 'replace':
          if (pop) {
            this.removeFragment(f, anim.popExit, 'popExit');
            for (const old of op.removed) this.addFragment(old, op.containerId, old.tag, anim.popEnter, 'popEnter');
          } else {
            op.removed = this.added.filter((other) => other !== f && other.containerId === op.containerId);
            for (const old of op.removed) this.removeFragment(old, anim.exit, 'exit');
            this.addFragment(f, op.containerId, op.tag, anim.enter, 'enter');
          }
          break;
        case 'remove':
          if (pop) this.addFragment(f, f.containerId, f.tag, anim.popEnter, 'popEnter');
          else this.removeFragment(f, anim.exit, 'exit');
          break;
        case 'show':
          this.setHidden(f, pop);
          break;
        case 'hide':
          this.setHidden(f, !pop);
          break;
        case 'detach':
          if (pop) this.attachFragment(f);
          else this.detachFragment(f);
          break;
        case 'attach':
          if (pop) this.detachFragment(f);
          else this.attachFragment(f);
          break;
      }
    }
  }

  private container(id: number): ViewGroup | null {
    if (id === View.NO_ID) return null;
    const scope = this.parent?.getView() ?? this.host.getWindow().getDecorView();
    const found = scope.findViewById(id);
    if (!found) throw new Error(`IllegalArgumentException: No view found for id 0x${id.toString(16)} for fragment`);
    return found as ViewGroup;
  }

  private addFragment(f: Fragment, containerId: number, tag: string | null, anim: FragmentAnimation | null, kind: 'enter' | 'popEnter'): void {
    if (f.manager && f.manager !== this) throw new Error(`IllegalStateException: Fragment ${f} is already added to another FragmentManager`);
    if (this.added.includes(f) && !f.removing) throw new Error(`IllegalStateException: Fragment already added: ${f}`);
    f.manager = this;
    f.containerId = containerId;
    f.tag = tag ?? f.tag;
    f.removing = false;
    f.hidden = false;
    if (!this.added.includes(f)) this.added.push(f);
    this.moveToState(f, this.hostState);
    const view = f.getView();
    if (view && view.getParent()) this.animateView(view, f.transitionFor(kind) ?? anim, null);
  }

  private removeFragment(f: Fragment, anim: FragmentAnimation | null, kind: 'exit' | 'popExit'): void {
    if (!this.added.includes(f)) return;
    f.removing = true;
    const at = this.added.indexOf(f);
    this.added.splice(at, 1);
    const view = f.getView();
    const animation = f.transitionFor(kind) ?? anim;
    const floor = this.keepCreated ? FragmentState.CREATED : FragmentState.INITIALIZING;
    if (view && view.getParent() && animation) {
      // keep the view until it has animated out
      this.lowerTo(f, FragmentState.CREATED, true);
      this.animateView(view, animation, () => {
        this.detachView(f, view);
        this.lowerTo(f, floor, false);
      });
    } else {
      this.lowerTo(f, floor, false);
    }
  }

  private setHidden(f: Fragment, hidden: boolean): void {
    if (f.hidden === hidden) return;
    f.hidden = hidden;
    f.getView()?.setVisibility(hidden ? View.GONE : View.VISIBLE);
    f.onHiddenChanged(hidden);
  }

  private detachFragment(f: Fragment): void {
    const at = this.added.indexOf(f);
    if (at >= 0) this.added.splice(at, 1);
    this.lowerTo(f, FragmentState.CREATED, false);
  }

  private attachFragment(f: Fragment): void {
    if (!this.added.includes(f)) this.added.push(f);
    this.moveToState(f, this.hostState);
  }

  /** @internal the host moved: bring every fragment along */
  dispatchState(hostState: number): void {
    // A created host has its fragments' views (ACTIVITY_CREATED): stopping keeps them.
    const state = hostState === FragmentState.CREATED ? FragmentState.VIEW_CREATED : hostState;
    this.hostState = state;
    for (const f of this.added.slice()) {
      if (state > f.state) this.moveToState(f, state);
      else this.lowerTo(f, state, false);
    }
  }

  private moveToState(f: Fragment, target: number): void {
    const host = this.host;
    if (f.state < FragmentState.ATTACHED && target >= FragmentState.ATTACHED) {
      f.state = FragmentState.ATTACHED;
      f.onAttach(host);
    }
    if (f.state < FragmentState.CREATED && target >= FragmentState.CREATED) {
      f.state = FragmentState.CREATED;
      f.onCreate(null);
      f.children?.dispatchState(FragmentState.CREATED);
    }
    if (f.state < FragmentState.VIEW_CREATED && target >= FragmentState.CREATED) {
      const container = this.container(f.containerId);
      const view = f.onCreateView(LayoutInflater.from(host), container, null);
      f.setViewInternal(view);
      f.state = FragmentState.VIEW_CREATED;
      if (view) {
        if (container) {
          if (view.getParent()) view.getParent()!.removeView(view);
          container.addView(view, -1, view.getLayoutParams() ?? new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        }
        if (f.hidden) view.setVisibility(View.GONE);
        f.onViewCreated(view, null);
      }
      f.children?.dispatchState(FragmentState.VIEW_CREATED);
    }
    if (f.state < FragmentState.STARTED && target >= FragmentState.STARTED) {
      f.state = FragmentState.STARTED;
      f.onStart();
      f.children?.dispatchState(FragmentState.STARTED);
    }
    if (f.state < FragmentState.RESUMED && target >= FragmentState.RESUMED) {
      f.state = FragmentState.RESUMED;
      f.onResume();
      f.children?.dispatchState(FragmentState.RESUMED);
    }
  }

  /** Bring a fragment down to `target` (INITIALIZING detaches it). Keeps the view in place when `keepView`. */
  private lowerTo(f: Fragment, target: number, keepView: boolean): void {
    if (f.state >= FragmentState.RESUMED && target < FragmentState.RESUMED) {
      f.children?.dispatchState(FragmentState.STARTED);
      f.onPause();
      f.state = FragmentState.STARTED;
    }
    if (f.state >= FragmentState.STARTED && target < FragmentState.STARTED) {
      f.children?.dispatchState(FragmentState.VIEW_CREATED);
      f.onStop();
      f.state = FragmentState.VIEW_CREATED;
    }
    if (keepView) return;
    if (f.state >= FragmentState.VIEW_CREATED && target < FragmentState.VIEW_CREATED) {
      f.children?.dispatchState(FragmentState.CREATED);
      const view = f.getView();
      f.onDestroyView();
      if (view) this.detachView(f, view);
      f.setViewInternal(null);
      f.state = FragmentState.CREATED;
    }
    if (f.state >= FragmentState.CREATED && target < FragmentState.CREATED) {
      f.children?.dispatchState(FragmentState.ATTACHED);
      f.onDestroy();
      f.state = FragmentState.ATTACHED;
    }
    if (f.state >= FragmentState.ATTACHED && target < FragmentState.ATTACHED) {
      f.onDetach();
      f.state = FragmentState.INITIALIZING;
      if (f.removing) f.manager = null;
    }
  }

  private detachView(_f: Fragment, view: View): void {
    view.getParent()?.removeView(view);
  }

  private animateView(view: View, anim: FragmentAnimation | null, end: (() => void) | null): void {
    if (!anim) {
      end?.();
      return;
    }
    const apply = (p: AnimatedProps) => {
      if (p.alpha !== undefined) view.setAlpha(p.alpha);
      if (p.translationX !== undefined) view.setTranslationX(p.translationX);
      if (p.translationY !== undefined) view.setTranslationY(p.translationY);
      if (p.scale !== undefined) {
        view.setScaleX(p.scale);
        view.setScaleY(p.scale);
      }
    };
    apply(anim.from);
    const lerp = (a: number | undefined, b: number | undefined, t: number) => (a === undefined || b === undefined ? b : a + (b - a) * t);
    const animator = ValueAnimator.ofFloat(0, 1);
    animator.setKernel(this.host.kernel);
    animator.setDuration(anim.duration);
    animator.setStartDelay(anim.startDelay ?? 0);
    animator.setInterpolator(anim.interpolator);
    animator.addUpdateListener((a) => {
      const t = a.getAnimatedValue() as number;
      apply({
        alpha: lerp(anim.from.alpha, anim.to.alpha, t),
        translationX: lerp(anim.from.translationX ?? 0, anim.to.translationX, t),
        translationY: lerp(anim.from.translationY ?? 0, anim.to.translationY, t),
        scale: lerp(anim.from.scale ?? 1, anim.to.scale, t),
      });
    });
    animator.addListener({ onAnimationEnd: () => end?.() });
    animator.start();
  }
}
