import type { Radii } from '@mimicry/protocol';
import { inflate, parseColor, type LayerContext, type Matrix } from '@mimicry/os-core';
import {
  Activity, Android, Color, FrameLayout, RADIUS_AUTO, RippleDrawable, StateSet, HorizontalScrollView, MeasureSpec, MotionEvent, OnBackPressedCallback, ProgressBar, ScrollView,
  SwitchCompat, View, ViewGroup, type Context,
} from '@mimicry/os-android';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';
import { drawNodeContent, drawNodeOverlay } from './draw';
import type { HostContainer, HostView, HostViewFactory, RippleConfig } from './host-view';
import { rgba } from '@mimicry/protocol';
import type { BoxGeometry } from '@mimicry/os-core';

/**
 * React Native's Android views on the View system: ReactViewGroup (views,
 * text, images, text inputs, SVG, modals), ReactScrollView /
 * ReactHorizontalScrollView, ReactSwitch (SwitchCompat) and the
 * ProgressBar container, inside a ReactRootView that is the activity's
 * content view. React Native lays these out itself (Yoga), so their
 * onLayout is a no-op and the mounting layer sets every frame.
 */
type ViewClass = abstract new (...args: any[]) => View;

function ReactView<T extends ViewClass>(Base: T) {
  abstract class Mixed extends Base implements HostView {
    abstract readonly node: HostNode;
    readonly mountedChildren: HostView[] = [];
    mountedParent: HostContainer | null = null;

    mountChild(child: HostView, index: number): void {
      const group = this as unknown as ViewGroup;
      const view = child as unknown as View;
      if (view.getParent()) view.getParent()!.removeView(view);
      group.addView(view, index);
      const at = this.mountedChildren.indexOf(child);
      if (at >= 0) this.mountedChildren.splice(at, 1);
      this.mountedChildren.splice(index, 0, child);
      child.mountedParent = this;
    }

    unmountChild(child: HostView): void {
      const at = this.mountedChildren.indexOf(child);
      if (at >= 0) this.mountedChildren.splice(at, 1);
      (this as unknown as ViewGroup).removeView(child as unknown as View);
      child.mountedParent = null;
    }

    mountFrame(x: number, y: number, w: number, h: number): void {
      super.setFrame(x, y, x + w, y + h);
    }

    setTransform(m: Matrix | null): void {
      this.setAnimationMatrix(m);
    }

    setOpacity(opacity: number): void {
      this.renderNode.opacity = opacity;
    }

    setHidden(hidden: boolean): void {
      this.renderNode.hidden = hidden;
    }

    setZIndex(z: number): void {
      this.renderNode.zIndex = z;
    }

    setClip(clip: boolean, radii: Radii): void {
      this.renderNode.masksToBounds = clip;
      this.renderNode.cornerRadii = radii;
    }

    setComposited(composited: boolean): void {
      this.renderNode.composited = composited;
    }

    get layer() {
      return this.renderNode;
    }

    private ripple: { drawable: RippleDrawable; foreground: boolean } | null = null;

    /**
     * Pressable's android_ripple: a RippleDrawable (React Native sets it as
     * the view's background or foreground) pressed at the touch point.
     */
    setRipplePressed(pressed: boolean, x: number | undefined, y: number | undefined, config: RippleConfig): void {
      const node = this.node;
      if (pressed) {
        const color = parseColor(config.color, node.engine.colorContext) ?? rgba(0, 0, 0, 0.12);
        const drawable = new RippleDrawable(Color.fromRgba(color), null, config.borderless ? null : 'bounded');
        if (typeof config.radius === 'number') drawable.setRadius(config.radius);
        else drawable.setRadius(RADIUS_AUTO);
        drawable.setCallback(this);
        drawable.setBounds(0, 0, node.w, node.h);
        drawable.setHotspot(x ?? node.w / 2, y ?? node.h / 2);
        this.ripple = { drawable, foreground: !!config.foreground };
        drawable.setState([StateSet.enabled, StateSet.pressed]);
      } else if (this.ripple) {
        this.ripple.drawable.setState([StateSet.enabled]);
      }
    }

    drawRipple(ctx: LayerContext, box: BoxGeometry, foreground: boolean): void {
      const ripple = this.ripple;
      if (!ripple || ripple.foreground !== foreground) return;
      const d = ripple.drawable;
      if (!d.isActive) return;
      d.maskRadii = box.radii;
      d.setBounds(box.x, box.y, box.x + box.w, box.y + box.h);
      const r = d.rippleBounds();
      if (!r) return;
      ctx.item({ x: r.left, y: r.top, w: r.width(), h: r.height() }, (w) => d.drawRipple(w));
    }

    /** React Native views animate on the engine's kernel even before they are attached. */
    override get kernel() {
      return this.node.engine.kernel;
    }

    updateProps(): void {}

    destroy(): void {}

    /** React Native positions children itself. */
    protected override onLayout(): void {}

    override requestLayout(): void {}
  }
  return Mixed;
}

/**
 * Drawing order of React Native children: zIndex, then (as the platform
 * does) elevation, then document order.
 */
function reactDrawingOrder(group: ViewGroup): View[] {
  const children: View[] = [];
  for (let i = 0; i < group.getChildCount(); i++) children.push(group.getChildAt(i)!);
  let needsSort = false;
  for (const c of children) {
    if (c.renderNode.zIndex !== 0 || elevationOf(c)) {
      needsSort = true;
      break;
    }
  }
  if (!needsSort) return children;
  return children
    .map((c, i) => ({ c, i, z: c.renderNode.zIndex, e: elevationOf(c) }))
    .sort((a, b) => a.z - b.z || a.e - b.e || a.i - b.i)
    .map((x) => x.c);
}

function elevationOf(view: View): number {
  const node = (view as unknown as { node?: HostNode }).node;
  return node ? Number(node.computed.elevation ?? 0) || 0 : 0;
}

class ReactViewGroup extends ReactView(ViewGroup) {
  constructor(context: Context, readonly node: HostNode) {
    super(context);
    // React Native clips only for overflow: hidden (set by the mounting layer).
    this.renderNode.masksToBounds = false;
  }

  override orderedChildren(): View[] {
    return reactDrawingOrder(this);
  }

  protected override drawContent(ctx: LayerContext): void {
    drawNodeContent(this.node, ctx);
  }

  protected override drawOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/** ReactModalHostView's content: its own composited layer, background only. */
class ReactModalHostView extends ReactViewGroup {
  protected override drawContent(ctx: LayerContext): void {
    const node = this.node;
    const background = parseColor(node.computed.backgroundColor, node.engine.colorContext);
    if (background) ctx.item({ x: ctx.x, y: ctx.y, w: node.w, h: node.h }, (w) => w.fillRect(ctx.x, ctx.y, node.w, node.h, background));
  }

  protected override drawOverlay(): void {}
}

/** The app's root view (React Native's ReactRootView content). */
class ReactRootViewContent extends ReactViewGroup {
  protected override drawContent(): void {}
  protected override drawOverlay(): void {}
}

/** The views on the hit paths of the pointers down right now. */
const touchRouting = new Set<unknown>();

function ScrollMixin<T extends abstract new (...args: any[]) => ScrollView>(Base: T) {
  abstract class Mixed extends ReactView(Base) {
    /** A drag may start only if no gesture handler that excludes it is active. */
    protected override allowsDrag(): boolean {
      return this.node.engine.gestures.canScroll(this.node);
    }

    override metrics() {
      return this.node.engine.scrolls.bounds(this.node);
    }

    override updateProps(): void {
      const p = this.node.props;
      this.setScrollEnabled(p.scrollEnabled !== false);
      this.pagingEnabled = !!p.pagingEnabled;
      this.snapToInterval = typeof p.snapToInterval === 'number' && p.snapToInterval > 0 ? p.snapToInterval : null;
      this.snapToOffsets = Array.isArray(p.snapToOffsets) ? p.snapToOffsets : null;
      this.snapToStart = p.snapToStart !== false;
      this.snapToEnd = p.snapToEnd !== false;
      this.decelerationRate = p.decelerationRate === 'fast' ? 'fast' : typeof p.decelerationRate === 'number' ? p.decelerationRate : 'normal';
      this.setVerticalScrollBarEnabled(p.showsVerticalScrollIndicator !== false);
      this.setHorizontalScrollBarEnabled(p.showsHorizontalScrollIndicator !== false);
      this.setOverScrollMode(p.bounces === false ? ScrollView.OVER_SCROLL_NEVER : ScrollView.OVER_SCROLL_IF_CONTENT_SCROLLS);
    }

    override orderedChildren(): View[] {
      return reactDrawingOrder(this);
    }

    protected override drawContent(ctx: LayerContext): void {
      drawNodeContent(this.node, ctx);
      super.drawContent(ctx);
    }

    protected override drawOverlay(ctx: LayerContext): void {
      drawNodeOverlay(this.node, ctx);
    }

    protected override onScrollEvent(): void {
      this.node.engine.scrolls.didScroll(this.node);
    }
  }
  return Mixed;
}

class ReactScrollView extends ScrollMixin(ScrollView) {
  constructor(context: Context, readonly node: HostNode) {
    super(context);
    this.callbacks = scrollCallbacks(node);
  }
}

class ReactHorizontalScrollView extends ScrollMixin(HorizontalScrollView) {
  constructor(context: Context, readonly node: HostNode) {
    super(context);
    this.callbacks = scrollCallbacks(node);
  }
}

function scrollCallbacks(node: HostNode) {
  const engine = node.engine;
  const scrolls = () => engine.scrolls;
  return {
    onDragStarted: () => {
      // NativeGestureUtil.notifyNativeGestureStarted: JS loses the touch.
      engine.input.nativeGestureStarted();
      engine.focus.dismissForScroll(node);
      scrolls().emitEvent(node, 'onScrollBeginDrag');
      engine.gestures.scrollStarted(node);
    },
    onDragEnded: (_v: ScrollView, velocity: { x: number; y: number }) => {
      scrolls().emitEvent(node, 'onScrollEndDrag', { velocity });
      engine.gestures.scrollEnded(node);
    },
    onFlingStarted: () => scrolls().emitEvent(node, 'onMomentumScrollBegin'),
    onScrollIdle: () => scrolls().emitEvent(node, 'onMomentumScrollEnd'),
  };
}

/** ReactSwitch: SwitchCompat with React Native's track and thumb colors. */
class ReactSwitch extends ReactView(SwitchCompat) {
  private value: boolean | null = null;

  constructor(context: Context, readonly node: HostNode) {
    super(context);
  }

  override updateProps(): void {
    const value = !!this.node.props.value;
    if (this.value === value) return;
    const first = this.value === null;
    this.value = value;
    this.setChecked(value, !first);
  }

  setControlPressed(pressed: boolean): void {
    this.setPressed(pressed);
  }

  cancelControlTouch(): void {
    this.onTouchEvent(MotionEvent.obtain(0, 0, MotionEvent.ACTION_CANCEL, [{ id: 0, x: 0, y: 0 }]));
  }

  /** A tap toggled it: tell JS, then show whatever value the props settle on. */
  override performClick(): boolean {
    const node = this.node;
    const next = !this.isChecked();
    this.setChecked(next);
    node.engine.events.emit(node, 'onChange', { value: next, target: node.id }, node.engine.animator.animationTime);
    this.value = !!node.props.value;
    this.setChecked(this.value);
    return true;
  }

  protected override drawContent(ctx: LayerContext): void {
    const node = this.node;
    drawNodeContent(node, ctx);
    const engine = node.engine;
    const colors = engine.colorContext;
    const track = node.props.trackColor ?? {};
    const state = {
      progress: this.progress,
      pressed: this.pressedAmount,
      disabled: !!node.props.disabled,
      trackOn: parseColor(track.true ?? node.props.onTintColor, colors),
      trackOff: parseColor(track.false ?? node.props.tintColor, colors),
      thumb: parseColor(node.props.thumbColor ?? node.props.thumbTintColor, colors),
      backgroundOff: parseColor(node.props.ios_backgroundColor, colors),
    };
    const s = engine.kit.switchSize;
    ctx.item(inflate({ x: ctx.x, y: ctx.y, w: s.width, h: s.height }, 12), (w) => engine.kit.drawSwitch(w, ctx.x, ctx.y, state, engine.env.appearance));
  }

  protected override drawOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/** ProgressBarContainerView: the box, then the indeterminate ProgressBar centered in it. */
class ReactProgressBarContainer extends ReactView(ProgressBar) {
  constructor(context: Context, readonly node: HostNode) {
    super(context);
  }

  protected override drawContent(ctx: LayerContext): void {
    const node = this.node;
    drawNodeContent(node, ctx);
    const engine = node.engine;
    const state = engine.behaviors.activityState(node);
    if (!state.animating && node.props.hidesWhenStopped !== false) return;
    const size = engine.kit.activitySize(node.props.size);
    const x = ctx.x + (node.w - size) / 2;
    const y = ctx.y + (node.h - size) / 2;
    ctx.item(inflate({ x, y, w: size, h: size }, 2), (w) => engine.kit.drawActivity(w, x, y, size, state, engine.env.appearance));
  }

  protected override drawOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/**
 * ReactRootView: the activity's content view, holding the app's root, the
 * presented modals and the system UI root. It draws the window background.
 */
class ReactRootView extends FrameLayout implements HostContainer {
  readonly mountedChildren: HostView[] = [];

  constructor(context: Context, private readonly engine: Engine) {
    super(context);
    this.renderNode.masksToBounds = false;
  }

  get layer() {
    return this.renderNode;
  }

  mountChild(child: HostView, index: number): void {
    const view = child as unknown as View;
    if (view.getParent()) view.getParent()!.removeView(view);
    this.addView(view, index);
    const at = this.mountedChildren.indexOf(child);
    if (at >= 0) this.mountedChildren.splice(at, 1);
    this.mountedChildren.splice(index, 0, child);
    child.mountedParent = this;
  }

  unmountChild(child: HostView): void {
    const at = this.mountedChildren.indexOf(child);
    if (at >= 0) this.mountedChildren.splice(at, 1);
    this.removeView(child as unknown as View);
    child.mountedParent = null;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    this.setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec));
  }

  protected override onLayout(): void {}

  protected override canReceivePointer(child: View): boolean {
    return touchRouting.has(child);
  }

  /**
   * Touches reach, in order: react-native-gesture-handler's arena (its root
   * view sees events first), the native views (scroll views may intercept,
   * switches press), then JS (JSTouchDispatcher, which a scroll view that
   * took over has already cancelled).
   */
  override dispatchTouchEvent(ev: MotionEvent): boolean {
    const input = this.engine.input;
    const action = ev.getActionMasked();
    const index = ev.getActionIndex();
    const time = ev.getEventTime();
    let path = null;
    if (action === MotionEvent.ACTION_DOWN || action === MotionEvent.ACTION_POINTER_DOWN) {
      path = input.pathAt(ev.getRawX(index), ev.getRawY(index));
      if (action === MotionEvent.ACTION_DOWN) touchRouting.clear();
      for (const n of path ?? []) if (n.hostView) touchRouting.add(n.hostView);
    } else if (action === MotionEvent.ACTION_MOVE) {
      for (let i = 0; i < ev.getPointerCount(); i++) input.feedArena('move', ev.getPointerId(i), ev.getRawX(i), ev.getRawY(i), time);
    } else if (action === MotionEvent.ACTION_UP || action === MotionEvent.ACTION_POINTER_UP) {
      input.feedArena('up', ev.getPointerId(index), ev.getRawX(index), ev.getRawY(index), time);
    }

    super.dispatchTouchEvent(ev);

    switch (action) {
      case MotionEvent.ACTION_DOWN:
      case MotionEvent.ACTION_POINTER_DOWN: {
        const stopped = !!path?.some((n) => n.kind === 'scroll' && (n.hostView as unknown as ScrollView | null)?.touchStoppedScrolling);
        input.down(ev.getPointerId(index), ev.getRawX(index), ev.getRawY(index), time, path, stopped);
        break;
      }
      case MotionEvent.ACTION_MOVE:
        for (let i = 0; i < ev.getPointerCount(); i++) input.move(ev.getPointerId(i), ev.getRawX(i), ev.getRawY(i), time);
        break;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_POINTER_UP:
        input.up(ev.getPointerId(index), ev.getRawX(index), ev.getRawY(index), time);
        if (action === MotionEvent.ACTION_UP) touchRouting.clear();
        break;
      case MotionEvent.ACTION_CANCEL:
        for (let i = 0; i < ev.getPointerCount(); i++) input.cancel(ev.getPointerId(i), ev.getRawX(i), ev.getRawY(i), time);
        touchRouting.clear();
        break;
    }
    return true;
  }

  override orderedChildren(): View[] {
    const out: View[] = [];
    for (let i = 0; i < this.getChildCount(); i++) out.push(this.getChildAt(i)!);
    return out;
  }

  protected override drawContent(ctx: LayerContext): void {
    const v = this.engine.viewport;
    ctx.item({ x: 0, y: 0, w: v.width, h: v.height }, (w) => w.fillRect(0, 0, v.width, v.height, this.engine.windowBackground()));
  }
}

/** ReactActivity: hosts the root view; hardware back goes to React Native first. */
class ReactActivity extends Activity {
  constructor(engine: Engine, os: Android, readonly root: ReactRootView) {
    super(os.kernel, os.windowManager);
    this.getOnBackPressedDispatcher().addCallback(new OnBackPressedCallback(true, () => engine.back()));
  }

  protected override onCreate(): void {
    this.setContentView(this.root);
  }
}

export class AndroidHostViews implements HostViewFactory {
  readonly surface: ReactRootView;
  readonly activity: ReactActivity;
  private readonly context: Context;

  constructor(engine: Engine, readonly os: Android) {
    this.context = os.context;
    this.surface = new ReactRootView(this.context, engine);
    this.activity = new ReactActivity(engine, os, this.surface);
    this.activity.launch();
  }

  createRoot(node: HostNode, app: boolean): HostView {
    return app ? new ReactRootViewContent(this.context, node) : new ReactViewGroup(this.context, node);
  }

  create(node: HostNode): HostView {
    switch (node.kind) {
      case 'scroll':
        return node.props.horizontal ? new ReactHorizontalScrollView(this.context, node) : new ReactScrollView(this.context, node);
      case 'switch':
        return new ReactSwitch(this.context, node);
      case 'activity':
        return new ReactProgressBarContainer(this.context, node);
      case 'modal':
        return new ReactModalHostView(this.context, node);
      default:
        return new ReactViewGroup(this.context, node);
    }
  }
}
