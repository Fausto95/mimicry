import type { Radii } from '@mimicry/protocol';
import { inflate, parseColor, type LayerContext, type Matrix } from '@mimicry/os-core';
import {
  Activity, Android, FrameLayout, HorizontalScrollView, MeasureSpec, OnBackPressedCallback, ProgressBar, ScrollView,
  SwitchCompat, View, ViewGroup, type Context,
} from '@mimicry/os-android';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';
import { drawNodeContent, drawNodeOverlay } from './draw';
import type { HostContainer, HostView, HostViewFactory } from './host-view';

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

function ScrollMixin<T extends abstract new (...args: any[]) => ScrollView>(Base: T) {
  abstract class Mixed extends ReactView(Base) {
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
  const scrolls = () => node.engine.scrolls;
  return {
    onDragStarted: () => scrolls().emitEvent(node, 'onScrollBeginDrag'),
    onDragEnded: (_v: ScrollView, velocity: { x: number; y: number }) => scrolls().emitEvent(node, 'onScrollEndDrag', { velocity }),
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
