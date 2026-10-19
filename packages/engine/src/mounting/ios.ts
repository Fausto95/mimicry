import type { Radii } from '@mimicry/protocol';
import { inflate, parseColor, type LayerContext, type Matrix } from '@mimicry/os-core';
import {
  IOS, UIActivityIndicatorView, UIControlEvents, UIGestureRecognizer, UIGestureRecognizerState, UIScrollView, UISwitch,
  UITouchPhase, UIView, UIViewController, UIScrollViewContentInsetAdjustmentBehavior, UIScrollViewDecelerationRate,
  UIScrollViewIndicatorStyle,
  type CGPoint, type UIEdgeInsets, type UIEvent, type UIScrollViewDelegate, type UITouch, type UIWindow,
} from '@mimicry/os-ios';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';
import { drawNodeContent, drawNodeOverlay } from './draw';
import type { HostContainer, HostView, HostViewFactory } from './host-view';

/**
 * React Native's iOS component views on UIKit: RCTViewComponentView (views,
 * text, images, text inputs, SVG, modals), RCTScrollViewComponentView on
 * UIScrollView, RCTSwitchComponentView on UISwitch and
 * RCTActivityIndicatorViewComponentView on UIActivityIndicatorView, inside an
 * RCTSurfaceView that is the root view controller's view.
 */
type UIViewClass = abstract new (...args: any[]) => UIView;

function ComponentView<T extends UIViewClass>(Base: T) {
  abstract class Mixed extends Base implements HostView {
    abstract readonly node: HostNode;
    readonly mountedChildren: HostView[] = [];
    mountedParent: HostContainer | null = null;

    mountChild(child: HostView, index: number): void {
      this.insertSubview(child as unknown as UIView, index);
      const at = this.mountedChildren.indexOf(child);
      if (at >= 0) this.mountedChildren.splice(at, 1);
      this.mountedChildren.splice(index, 0, child);
      child.mountedParent = this;
    }

    unmountChild(child: HostView): void {
      const at = this.mountedChildren.indexOf(child);
      if (at >= 0) this.mountedChildren.splice(at, 1);
      (child as unknown as UIView).removeFromSuperview();
      child.mountedParent = null;
    }

    mountFrame(x: number, y: number, w: number, h: number): void {
      this.layer.setFrame(x, y, w, h);
    }

    setTransform(m: Matrix | null): void {
      // React Native resolves transform-origin itself: the matrix applies about the top-left.
      this.layer.anchorPoint = { x: 0, y: 0 };
      this.layer.affineTransform = m;
    }

    setOpacity(opacity: number): void {
      this.layer.opacity = opacity;
    }

    setHidden(hidden: boolean): void {
      this.layer.hidden = hidden;
    }

    setZIndex(z: number): void {
      this.layer.zIndex = z;
    }

    setClip(clip: boolean, radii: Radii): void {
      this.layer.masksToBounds = clip;
      this.layer.cornerRadii = radii;
    }

    setComposited(composited: boolean): void {
      this.layer.composited = composited;
    }

    updateProps(): void {}

    destroy(): void {}
  }
  return Mixed;
}

/** RCTViewComponentView: every box-like host component. */
class RCTViewComponentView extends ComponentView(UIView) {
  constructor(readonly node: HostNode) {
    super();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    drawNodeContent(this.node, ctx);
  }

  protected override drawLayerOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/** The modal host's content: its own composited layer with the sheet's rounded top. */
class RCTModalHostViewComponentView extends RCTViewComponentView {
  protected override drawLayerContent(ctx: LayerContext): void {
    const node = this.node;
    const background = parseColor(node.computed.backgroundColor, node.engine.colorContext);
    if (background) ctx.item({ x: ctx.x, y: ctx.y, w: node.w, h: node.h }, (w) => w.fillRect(ctx.x, ctx.y, node.w, node.h, background));
  }

  protected override drawLayerOverlay(): void {}
}

/** The app's root view: while a page sheet is presented, the scaled-back card. */
class RCTRootComponentView extends RCTViewComponentView {
  protected override drawLayerContent(ctx: LayerContext): void {
    const engine = this.node.engine;
    if (!engine.presentation) return;
    const v = engine.viewport;
    const background = engine.windowBackground();
    ctx.item({ x: ctx.x, y: ctx.y, w: v.width, h: v.height }, (w) => w.fillRect(ctx.x, ctx.y, v.width, v.height, background));
  }

  protected override drawLayerOverlay(): void {}
}

class RCTScrollViewComponentView extends ComponentView(UIScrollView) implements UIScrollViewDelegate {
  constructor(readonly node: HostNode) {
    super();
    this.delegate = this;
  }

  private get engine(): Engine {
    return this.node.engine;
  }

  /** React Native scroll views animate on the engine's kernel even before they are on screen. */
  protected override get kernel() {
    return this.node.engine.kernel;
  }

  override metrics() {
    return this.engine.scrolls.bounds(this.node);
  }

  override get adjustedContentInset(): UIEdgeInsets {
    return this.engine.scrolls.contentInsets(this.node);
  }

  override updateProps(): void {
    const p = this.node.props;
    this.horizontal = !!p.horizontal;
    this.isScrollEnabled = p.scrollEnabled !== false;
    this.bounces = p.bounces !== false;
    this.alwaysBounceVertical = p.alwaysBounceVertical !== false;
    this.alwaysBounceHorizontal = !!p.alwaysBounceHorizontal;
    this.isPagingEnabled = !!p.pagingEnabled;
    this.snapToInterval = typeof p.snapToInterval === 'number' && p.snapToInterval > 0 ? p.snapToInterval : null;
    this.snapToOffsets = Array.isArray(p.snapToOffsets) ? p.snapToOffsets : null;
    this.snapToStart = p.snapToStart !== false;
    this.snapToEnd = p.snapToEnd !== false;
    this.decelerationRate = p.decelerationRate === 'fast'
      ? UIScrollViewDecelerationRate.fast
      : typeof p.decelerationRate === 'number' ? p.decelerationRate : UIScrollViewDecelerationRate.normal;
    this.showsVerticalScrollIndicator = p.showsVerticalScrollIndicator !== false;
    this.showsHorizontalScrollIndicator = p.showsHorizontalScrollIndicator !== false;
    const behavior = p.contentInsetAdjustmentBehavior;
    this.contentInsetAdjustmentBehavior = behavior === 'automatic'
      ? UIScrollViewContentInsetAdjustmentBehavior.automatic
      : behavior === 'always' ? UIScrollViewContentInsetAdjustmentBehavior.always
        : behavior === 'scrollableAxes' ? UIScrollViewContentInsetAdjustmentBehavior.scrollableAxes
          : UIScrollViewContentInsetAdjustmentBehavior.never;
    this.indicatorStyle = p.indicatorStyle === 'black' ? UIScrollViewIndicatorStyle.black : p.indicatorStyle === 'white' ? UIScrollViewIndicatorStyle.white : UIScrollViewIndicatorStyle.default;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    drawNodeContent(this.node, ctx);
  }

  protected override drawLayerOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }

  /**
   * The pan may begin only if no gesture handler that excludes it is active
   * (react-native-gesture-handler's arena decides, after seeing this move).
   */
  override gestureRecognizerShouldBegin(recognizer: UIGestureRecognizer): boolean {
    if (recognizer !== this.panGestureRecognizer) return super.gestureRecognizerShouldBegin(recognizer);
    feedArena(this.engine, recognizer);
    return this.engine.gestures.canScroll(this.node);
  }

  // UIScrollViewDelegate → React Native scroll events
  scrollViewDidScroll(): void {
    this.engine.scrolls.didScroll(this.node);
  }

  scrollViewWillBeginDragging(): void {
    this.engine.focus.dismissForScroll(this.node);
    this.engine.scrolls.emitEvent(this.node, 'onScrollBeginDrag');
    this.engine.gestures.scrollStarted(this.node);
  }

  scrollViewWillEndDragging(_s: UIScrollView, velocity: CGPoint): void {
    feedArena(this.engine, this.panGestureRecognizer);
    this.engine.scrolls.emitEvent(this.node, 'onScrollEndDrag', { velocity: { x: velocity.x, y: velocity.y } });
  }

  scrollViewDidEndDragging(): void {
    this.engine.gestures.scrollEnded(this.node);
  }

  scrollViewWillBeginDecelerating(): void {
    this.engine.scrolls.emitEvent(this.node, 'onMomentumScrollBegin');
  }

  scrollViewDidEndDecelerating(): void {
    this.engine.scrolls.emitEvent(this.node, 'onMomentumScrollEnd');
  }
}

/** RCTSwitchComponentView: the box, then the UISwitch it hosts. */
class RCTSwitchComponentView extends ComponentView(UISwitch) {
  private value: boolean | null = null;

  constructor(readonly node: HostNode) {
    super();
    this.addTarget(() => this.valueChanged(), UIControlEvents.valueChanged);
  }

  override updateProps(): void {
    this.isEnabled = !this.node.props.disabled;
    const value = !!this.node.props.value;
    if (this.value === value) return;
    const first = this.value === null;
    this.value = value;
    this.setOn(value, !first);
  }

  /** The user toggled it: tell JS, then show whatever value the props settle on. */
  private valueChanged(): void {
    const node = this.node;
    node.engine.events.emit(node, 'onChange', { value: this.isOn, target: node.id }, node.engine.animator.animationTime);
    this.value = !!node.props.value;
    this.setOn(this.value, true);
  }

  setControlPressed(pressed: boolean): void {
    this.isHighlighted = pressed;
  }

  cancelControlTouch(): void {
    this.touchesCancelled(new Set(), null as unknown as UIEvent);
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    const node = this.node;
    drawNodeContent(node, ctx);
    const engine = node.engine;
    const colors = engine.colorContext;
    const track = node.props.trackColor ?? {};
    const state = {
      progress: this.progress,
      pressed: this.pressed,
      disabled: !!node.props.disabled,
      trackOn: parseColor(track.true ?? node.props.onTintColor, colors),
      trackOff: parseColor(track.false ?? node.props.tintColor, colors),
      thumb: parseColor(node.props.thumbColor ?? node.props.thumbTintColor, colors),
      backgroundOff: parseColor(node.props.ios_backgroundColor, colors),
    };
    const s = engine.kit.switchSize;
    ctx.item(inflate({ x: ctx.x, y: ctx.y, w: s.width, h: s.height }, 12), (w) => engine.kit.drawSwitch(w, ctx.x, ctx.y, state, engine.env.appearance));
  }

  protected override drawLayerOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/** RCTActivityIndicatorViewComponentView: the box, then the spinner centered in it. */
class RCTActivityIndicatorViewComponentView extends ComponentView(UIActivityIndicatorView) {
  constructor(readonly node: HostNode) {
    super();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
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

  protected override drawLayerOverlay(ctx: LayerContext): void {
    drawNodeOverlay(this.node, ctx);
  }
}

/** RCTSurfaceView: the full-screen container the root view controller shows. */
class RCTSurfaceView extends UIView implements HostContainer {
  readonly mountedChildren: HostView[] = [];

  constructor(private readonly engine: Engine) {
    super();
    this.addGestureRecognizer(new RCTSurfaceTouchHandler(engine));
  }

  /**
   * React Native's hit testing (pointerEvents, hitSlop, zIndex, overflow,
   * text spans) decides which view a touch lands in; UIKit then delivers it
   * to that view and the recognizers above it.
   */
  override hitTest(point: CGPoint, _event: UIEvent | null): UIView | null {
    const window = this.convertPoint(point, null);
    const path = this.engine.input.pathAt(window.x, window.y);
    if (!path) return this;
    for (let i = path.length - 1; i >= 0; i--) {
      const view = path[i]!.hostView;
      if (view && (view as unknown as UIView).window) return view as unknown as UIView;
    }
    return this;
  }

  mountChild(child: HostView, index: number): void {
    this.insertSubview(child as unknown as UIView, index);
    const at = this.mountedChildren.indexOf(child);
    if (at >= 0) this.mountedChildren.splice(at, 1);
    this.mountedChildren.splice(index, 0, child);
    child.mountedParent = this;
  }

  unmountChild(child: HostView): void {
    const at = this.mountedChildren.indexOf(child);
    if (at >= 0) this.mountedChildren.splice(at, 1);
    (child as unknown as UIView).removeFromSuperview();
    child.mountedParent = null;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    const v = this.engine.viewport;
    // Behind a scaled-back presenting app, the window is black (iOS page sheets).
    const fill = this.engine.presentation ? 0x000000ff : this.engine.windowBackground();
    ctx.item({ x: 0, y: 0, w: v.width, h: v.height }, (w) => w.fillRect(0, 0, v.width, v.height, fill));
  }
}

/**
 * RCTSurfaceTouchHandler: a gesture recognizer on the surface that sees
 * every touch and drives the JS responder system. It never prevents other
 * recognizers; when one that can cancel it begins (a scroll view's pan), it
 * cancels the JS touches instead of being prevented — React Native's
 * canBePreventedByGestureRecognizer.
 */
class RCTSurfaceTouchHandler extends UIGestureRecognizer {
  constructor(private readonly engine: Engine) {
    super();
    this.cancelsTouchesInView = false;
    this.delaysTouchesEnded = false;
  }

  override touchesBegan(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    for (const t of touches) {
      const p = t.windowLocation;
      const path = this.engine.input.pathAt(p.x, p.y);
      const stopped = !!path?.some((n) => n.kind === 'scroll' && (n.hostView as unknown as UIScrollView | null)?.touchStoppedScrolling);
      this.engine.input.down(t.identifier, p.x, p.y, t.timestamp, path, stopped);
    }
    if (this.state === UIGestureRecognizerState.possible) this.state = UIGestureRecognizerState.began;
  }

  override touchesMoved(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    for (const t of touches) {
      const p = t.windowLocation;
      this.engine.input.move(t.identifier, p.x, p.y, t.timestamp);
    }
    if (this.isActive) this.state = UIGestureRecognizerState.changed;
  }

  override touchesEnded(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    for (const t of touches) {
      const p = t.windowLocation;
      this.engine.input.up(t.identifier, p.x, p.y, t.timestamp);
    }
    if (this.numberOfTouches === 0 && this.isActive) this.state = UIGestureRecognizerState.ended;
  }

  override touchesCancelled(touches: ReadonlySet<UITouch>, _event: UIEvent): void {
    for (const t of touches) {
      const p = t.windowLocation;
      this.engine.input.cancel(t.identifier, p.x, p.y, t.timestamp);
    }
    if (this.numberOfTouches === 0 && this.isActive) this.state = UIGestureRecognizerState.cancelled;
  }

  override canPrevent(): boolean {
    return false;
  }

  override canBePrevented(by: UIGestureRecognizer): boolean {
    if (by.state === UIGestureRecognizerState.began || by.state === UIGestureRecognizerState.changed) {
      this.engine.input.nativeGestureStarted();
    }
    return false;
  }
}

/** Show the arena a native recognizer's current sample before it decides (deduplicated). */
function feedArena(engine: Engine, recognizer: UIGestureRecognizer): void {
  for (const t of recognizer._touches) {
    const p = t.windowLocation;
    const phase = t.phase === UITouchPhase.ended ? 'up' : t.phase === UITouchPhase.cancelled ? 'cancel' : t.phase === UITouchPhase.began ? null : 'move';
    if (phase) engine.input.feedArena(phase, t.identifier, p.x, p.y, t.timestamp);
  }
}

export class IOSHostViews implements HostViewFactory {
  readonly surface: RCTSurfaceView;
  readonly window: UIWindow;
  readonly systemWindow: UIWindow;

  constructor(engine: Engine, readonly os: IOS) {
    const app = os.application;
    this.window = app.makeWindow();
    const controller = new UIViewController();
    this.surface = new RCTSurfaceView(engine);
    controller.view = this.surface;
    this.window.rootViewController = controller;
    this.window.makeKeyAndVisible();
    // System UI written in React (RedBox, LogBox, alerts) shares the surface; see mounting.ts.
    this.systemWindow = this.window;
    os.statusBar.styleOverride = () => (engine.presentation ? 'light-content' : null);
  }

  createRoot(node: HostNode, app: boolean): HostView {
    return app ? new RCTRootComponentView(node) : new RCTViewComponentView(node);
  }

  create(node: HostNode): HostView {
    switch (node.kind) {
      case 'scroll':
        return new RCTScrollViewComponentView(node);
      case 'switch':
        return new RCTSwitchComponentView(node);
      case 'activity':
        return new RCTActivityIndicatorViewComponentView(node);
      case 'modal':
        return new RCTModalHostViewComponentView(node);
      default:
        return new RCTViewComponentView(node);
    }
  }
}
