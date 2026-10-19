import type { Radii } from '@mimicry/protocol';
import { inflate, parseColor, type LayerContext, type Matrix } from '@mimicry/os-core';
import {
  IOS, UIActivityIndicatorView, UIScrollView, UISwitch, UIView, UIViewController,
  UIScrollViewContentInsetAdjustmentBehavior, UIScrollViewDecelerationRate, UIScrollViewIndicatorStyle,
  type CGPoint, type UIEdgeInsets, type UIScrollViewDelegate, type UIWindow,
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

  // UIScrollViewDelegate → React Native scroll events
  scrollViewDidScroll(): void {
    this.engine.scrolls.didScroll(this.node);
  }

  scrollViewWillBeginDragging(): void {
    this.engine.scrolls.emitEvent(this.node, 'onScrollBeginDrag');
  }

  scrollViewWillEndDragging(_s: UIScrollView, velocity: CGPoint): void {
    this.engine.scrolls.emitEvent(this.node, 'onScrollEndDrag', { velocity: { x: velocity.x, y: velocity.y } });
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
  }

  override updateProps(): void {
    const value = !!this.node.props.value;
    if (this.value === value) return;
    const first = this.value === null;
    this.value = value;
    this.setOn(value, !first);
  }

  setControlPressed(pressed: boolean): void {
    this.isHighlighted = pressed;
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
