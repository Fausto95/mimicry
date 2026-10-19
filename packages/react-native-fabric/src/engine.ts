import type { Config as YogaConfig, Yoga } from 'yoga-layout/load';
import { Errata } from 'yoga-layout/load';
import {
  rgba,
  type CapabilityLevel,
  type EngineError,
  type EngineMessage,
  type EnvironmentSpec,
  type HostMessage,
  type InspectorNode,
  type SerializedSelector,
  type Viewport,
} from '@mimicry/protocol';
import type { ReactNode } from 'react';
import { Android } from '@mimicry/os-android';
import {
  Kernel, hyphenationPoints, layoutText, parseColor,
  type Animator, type Clock, type ColorContext, type EnvironmentStore, type ImageStore, type Matrix, type OperatingSystem,
  type PlatformKit, type TextLayout, type TextLayoutOptions, type TextMeasurer, type TextStyle,
} from '@mimicry/os-core';
import { IOS } from '@mimicry/os-ios';
import { NO_CLIP, type ClipSpec } from '@mimicry/protocol';
import { Behaviors } from './behaviors';
import { EventDispatcher } from './events';
import { FocusManager } from './focus';
import { TextInputBinding } from './input/text-input';
import { Geometry } from './geometry';
import { hitTest } from './input/hit-test';
import { PointerInput } from './input/pointer';
import { GestureArena } from './input/gestures/arena';
import { ScrollManager } from './input/scroll';
import { runLayout } from './layout/layout';
import { AndroidHostViews } from './mounting/android';
import type { HostViewFactory } from './mounting/host-view';
import { IOSHostViews } from './mounting/ios';
import { Mounting } from './mounting/mounting';
import { collectSpans, resolveTextStyle, type TextEnvironment } from './text/spans';
import { HostNode } from './tree/node';
import { batchedUpdates, createFiberRoot, renderInto, type RootContainer } from './tree/reconciler';

export interface EngineOptions {
  yoga: Yoga;
  /** the operating system React Native runs on (see @mimicry/device's bootDevice) */
  os: IOS | Android;
}

export interface EngineHooks {
  /** shows a RedBox / LogBox; provided by @mimicry/react-native */
  onError?: (error: EngineError) => void;
  /** Android hardware back; returns true when handled */
  onBack?: () => boolean;
  capabilities?: () => Record<string, CapabilityLevel>;
}

/**
 * React Native on a simulated OS. The engine is React Native's native side —
 * what Fabric's UIManager, mounting layer and view managers are on device:
 * a React renderer over a retained shadow tree laid out by Yoga, mounted
 * into the OS's views (UIKit on iOS, the View system on Android), which the
 * kernel's render server draws. It has no DOM dependency — it runs in a Web
 * Worker in the browser and directly in Node for headless tests.
 */
export class Engine {
  readonly kernel: Kernel;
  readonly os: OperatingSystem;
  readonly yoga: Yoga;
  readonly yogaConfig: YogaConfig;
  readonly measurer: TextMeasurer;
  readonly env: EnvironmentStore;
  readonly clock: Clock;
  readonly animator: Animator;
  readonly geometry: Geometry;
  readonly events: EventDispatcher;
  readonly images: ImageStore;
  readonly mounting: Mounting;
  readonly focus: FocusManager;
  readonly behaviors: Behaviors;
  readonly scrolls: ScrollManager;
  readonly input: PointerInput;
  readonly gestures: GestureArena;
  readonly nodes = new Map<number, HostNode>();
  readonly modals = new Set<HostNode>();
  /** views padded by their safe area insets (`safeAreaEdges`), see layout/safe-area.ts */
  readonly safeAreaNodes = new Set<HostNode>();
  /** views nested inside <Text> (laid out as inline boxes by the text) */
  readonly inlineViews = new Set<HostNode>();
  readonly appRoot: RootContainer;
  readonly systemRoot: RootContainer;
  readonly hooks: EngineHooks;
  readonly bundledFonts: boolean;
  readonly hostInputs: boolean;
  readonly kit: PlatformKit;

  private colorCache: ColorContext | null = null;
  private rootBackground: number | null = null;

  constructor(options: EngineOptions) {
    this.yoga = options.yoga;
    this.os = options.os;
    this.kernel = options.os.kernel;
    const kernel = this.kernel;
    this.measurer = kernel.measurer;
    this.clock = kernel.clock;
    this.animator = kernel.animator;
    this.env = kernel.env;
    this.images = kernel.images;
    this.hooks = kernel.hooks;
    this.bundledFonts = kernel.bundledFonts;
    this.hostInputs = kernel.hostInputs;
    const ios = this.os instanceof IOS;
    this.kit = this.os.theme;
    this.yogaConfig = this.yoga.Config.create();
    // React Native rounds layout to the physical pixel grid and runs Yoga in compatibility mode.
    this.yogaConfig.setPointScaleFactor(this.env.viewport.scale);
    this.yogaConfig.setErrata(Errata.All);
    this.yogaConfig.setUseWebDefaults(false);

    this.geometry = new Geometry(this);
    this.events = new EventDispatcher((error) => this.reportError(error, 'runtime'));
    this.focus = new FocusManager(this);
    this.behaviors = new Behaviors(this);
    this.scrolls = new ScrollManager(this);
    this.input = new PointerInput(this);
    this.gestures = new GestureArena(this);
    const views: HostViewFactory = this.os instanceof IOS ? new IOSHostViews(this, this.os) : new AndroidHostViews(this, this.os as Android);
    this.mounting = new Mounting(this, views);

    this.appRoot = this.createContainer('app');
    this.systemRoot = this.createContainer('system');
    this.env.subscribe((_env, changed) => this.environmentChanged(changed));

    kernel.batch = (fn) => batchedUpdates(fn);
    kernel.nodeCount = () => this.nodes.size;
    kernel.addLayoutPass(() => this.layout());
    kernel.addBeforePaint(() => this.mounting.sync());
    // Touches reach React Native through the OS (RCTSurfaceTouchHandler / ReactRootView).
    kernel.addBeforeInput(() => this.mounting.sync());
    // UIKit routes wheels to UIScrollView; Android has no wheel routing of its own here.
    if (!ios) {
      kernel.on('wheel', (m) => {
        kernel.prepareInput();
        this.input.wheel(m.x, m.y, m.dx, m.dy);
      });
    }
    kernel.on('inspect', (m) => this.send({ type: 'inspectResult', requestId: m.requestId, tree: this.inspect() }));
    kernel.on('hitTest', (m) => {
      const path = hitTest(this, m.x, m.y);
      this.send({ type: 'hitTestResult', requestId: m.requestId, nodeId: path?.at(-1)?.id ?? null, path: path?.map((n) => n.id) ?? [] });
    });
    kernel.on('query', (m) => this.send({ type: 'queryResult', requestId: m.requestId, nodes: this.query(m.selector) }));
    // Android's back key goes through the activity (ReactActivity hands it to us); iOS has none.
    if (ios) kernel.on('back', () => this.back());
  }

  private createContainer(name: 'app' | 'system'): RootContainer {
    const root = new HostNode(this, 'm-root', 'root', { style: { flex: 1 } });
    root.hostView = this.mounting.createView(root, name);
    root.mounted = true;
    if (name === 'system') root.setProps({ style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, pointerEvents: 'box-none' });
    const container: RootContainer = { engine: this, root, name };
    createFiberRoot(container, (error, info, kind) => {
      if (kind === 'recoverable') return;
      this.reportError(error, 'render', info.componentStack);
    });
    return container;
  }

  // ── public API ────────────────────────────────────────────────────────

  get viewport(): Viewport {
    return this.env.viewport;
  }

  get platform() {
    return this.kit.platform;
  }

  render(element: ReactNode): void {
    renderInto(this.appRoot, element);
  }

  renderSystem(element: ReactNode): void {
    renderInto(this.systemRoot, element);
  }

  send(message: EngineMessage, transfer?: Transferable[]): void {
    this.kernel.send(message, transfer);
  }

  handle(message: HostMessage): void {
    this.kernel.handle(message);
  }

  back(): void {
    const modals = this.visibleModals();
    const top = modals[modals.length - 1];
    if (top) {
      this.events.emit(top, 'onRequestClose', { target: top.id }, this.animator.animationTime);
      return;
    }
    if (!this.hooks.onBack?.()) this.warnOnce('back', 'Back pressed with no handler (the app would exit).');
  }

  // ── frame pipeline (the kernel's) ─────────────────────────────────────

  requestFrame(): void {
    this.kernel.requestFrame();
  }

  get frameIsRequested(): boolean {
    return this.kernel.frameIsRequested;
  }

  invalidateLayout(): void {
    this.kernel.setNeedsLayout();
  }

  markPaint(): void {
    this.kernel.setNeedsDisplay();
  }

  /** One frame: animations → layout if dirty → mount → render → send. */
  frame(time: number): void {
    this.kernel.frame(time);
  }

  /** Paint immediately and return the frame (headless screenshots). */
  paintNow(): ArrayBuffer {
    return this.kernel.paintNow();
  }

  /** React Native's layout pass: Yoga, then the effects of the new frames. */
  private layout(): void {
    const changes = runLayout(this);
    this.scrolls.clampAfterLayout();
    if (changes.length) {
      const time = this.animator.animationTime;
      this.defer(() => {
        for (const { node, layout } of changes) {
          if (node.mounted) this.events.emit(node, 'onLayout', { layout, target: node.id }, time, 'default');
        }
      });
    }
  }

  // ── deferred work ─────────────────────────────────────────────────────

  /**
   * Run `fn` after the current task, like React Native's async events
   * (onLayout, onLoad from cache). See Kernel.defer.
   */
  defer(fn: () => void): void {
    this.kernel.defer(fn);
  }

  get hasDeferred(): boolean {
    return this.kernel.hasDeferred;
  }

  flushDeferred(): void {
    this.kernel.flushDeferred();
  }

  /** Called by the reconciler after every commit, before layout effects run. */
  afterCommit(_root: RootContainer): void {
    this.kernel.layoutIfNeeded();
    this.kernel.setNeedsDisplay();
  }

  // ── tree bookkeeping ──────────────────────────────────────────────────

  onNodeChanged(_node: HostNode): void {
    this.kernel.setNeedsDisplay();
  }

  onAttach(node: HostNode): void {
    this.mounting.structureChanged();
    const parentMounted = node.parent?.mounted ?? false;
    if (!parentMounted) return;
    node.walk((n) => {
      if (!n.mounted) {
        n.mounted = true;
        this.nodes.set(n.id, n);
        if (n.kind === 'modal') this.modals.add(n);
        if (n.props.safeAreaEdges) this.safeAreaNodes.add(n);
        if (n.kind === 'input') this.kernel.textInput.register(n.id, new TextInputBinding(this, n));
        this.behaviors.attached(n);
      }
    });
  }

  onDetach(node: HostNode): void {
    this.mounting.structureChanged();
    node.walk((n) => {
      if (n.mounted) {
        n.mounted = false;
        this.modals.delete(n);
        this.safeAreaNodes.delete(n);
        this.behaviors.detached(n);
        if (this.focus.focused === n) this.focus.blur(n);
        if (n.kind === 'input') this.kernel.textInput.unregister(n.id);
      }
    });
  }

  onDestroy(node: HostNode): void {
    this.nodes.delete(node.id);
    this.modals.delete(node);
    this.safeAreaNodes.delete(node);
    this.inlineViews.delete(node);
    this.images.forget(node.imageConsumer);
    this.gestures.nodeDestroyed(node);
  }

  visibleModals(): HostNode[] {
    return Array.from(this.modals).filter((m) => m.mounted && this.behaviors.isModalShown(m));
  }

  /** While an iOS page sheet is presented: how the app behind it is scaled back. */
  get presentation(): { matrix: Matrix; clip: ClipSpec; radius: number } | null {
    const p = this.behaviors.presentingTransform();
    return p ? { matrix: p.matrix, clip: NO_CLIP, radius: p.radius } : null;
  }

  // ── environment ───────────────────────────────────────────────────────

  private environmentChanged(changed: { dimensions: boolean; appearance: boolean; device: boolean }): void {
    if (changed.device) {
      if (this.env.device.platform !== this.kit.platform) {
        this.warnOnce('platform-switch', `Switching to an ${this.env.device.platform} device needs a new engine (the OS is chosen at boot).`);
      }
      this.yogaConfig.setPointScaleFactor(this.env.viewport.scale);
    }
    this.colorCache = null;
    for (const node of this.nodes.values()) {
      if (node.kind === 'text' || node.kind === 'input') node.invalidateText();
      if (changed.device) node.refreshLayoutStyle();
    }
    this.invalidateLayout();
  }

  get colorContext(): ColorContext {
    if (!this.colorCache) {
      const appearance = this.env.appearance;
      const kit = this.kit;
      this.colorCache = { appearance, semantic: (name) => kit.semanticColor(name, appearance) };
    }
    return this.colorCache;
  }

  /** The root view's background (expo-system-ui's setBackgroundColorAsync). */
  setRootBackground(color: unknown): void {
    this.rootBackground = color == null ? null : parseColor(color, this.colorContext);
    this.markPaint();
  }

  windowBackground(): number {
    if (this.rootBackground != null) return this.rootBackground;
    const dark = this.env.appearance === 'dark';
    if (this.kit.platform === 'ios') return dark ? rgba(0, 0, 0) : rgba(255, 255, 255);
    return dark ? rgba(18, 18, 18) : rgba(255, 255, 255);
  }

  // ── fonts ─────────────────────────────────────────────────────────────

  /** Register a custom font (expo-font). Resolves once text can measure with it. */
  async loadFont(family: string, url: string, descriptors: { weight?: string; style?: string } = {}): Promise<void> {
    await this.kernel.loadFont(family, url, descriptors);
    for (const node of this.nodes.values()) if (node.kind === 'text' || node.kind === 'input') node.invalidateText();
    this.invalidateLayout();
  }

  loadedFonts(): string[] {
    return this.kernel.loadedFonts();
  }

  // ── text ──────────────────────────────────────────────────────────────

  get textEnvironment(): TextEnvironment {
    return {
      kit: this.kit,
      appearance: this.env.appearance,
      colors: this.colorContext,
      fontScale: this.env.fontScale,
      bundledFonts: this.bundledFonts,
    };
  }

  textLayoutFor(node: HostNode, width: number): TextLayout {
    const key = width === Infinity ? -1 : Math.round(width * 64);
    if (!node.textLayout) node.textLayout = new Map();
    let layout = node.textLayout.get(key);
    if (!layout) {
      layout = this.computeTextLayout(node, width);
      if (node.textLayout.size > 6) node.textLayout.clear();
      node.textLayout.set(key, layout);
    }
    return layout;
  }

  private computeTextLayout(node: HostNode, width: number): TextLayout {
    const props = node.props;
    const options: TextLayoutOptions = {
      numberOfLines: props.numberOfLines,
      ellipsizeMode: props.ellipsizeMode,
      hyphenation: this.hyphenationFor(node),
    };
    const inlineSize = (n: HostNode) => n.native.inlineSize ?? { width: 0, height: 0 };
    const run = (fitScale: number) =>
      layoutText(collectSpans(node, fitScale === 1 ? this.textEnvironment : { ...this.textEnvironment, fitScale }, inlineSize), width, options, this.measurer);
    const layout = run(1);
    if (!props.adjustsFontSizeToFit || width === Infinity) return layout;
    // adjustsFontSizeToFit: the largest scale (≥ minimumFontScale) at which the text
    // fits its lines and box without truncating or breaking a word.
    const maxHeight = this.fitHeight(node);
    const fits = (l: TextLayout) => !l.truncated && !l.brokeWord && l.height <= maxHeight + 0.5;
    if (fits(layout)) return layout;
    const min = Math.min(1, Math.max(0.01, Number(props.minimumFontScale) || 0.01));
    let best = run(min);
    if (!fits(best)) return best;
    let lo = min;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const candidate = run(mid);
      if (fits(candidate)) {
        lo = mid;
        best = candidate;
      } else hi = mid;
    }
    return best;
  }

  /** The content height a text must fit for adjustsFontSizeToFit (its fixed height, if any). */
  private fitHeight(node: HostNode): number {
    const style = node.computed;
    const fixed = typeof style.height === 'number' ? style.height : typeof style.maxHeight === 'number' ? style.maxHeight : Infinity;
    return fixed - node.insets.top - node.insets.bottom;
  }

  /** Android's `android_hyphenationFrequency` ('none' by default; iOS never hyphenates). */
  private hyphenationFor(node: HostNode): TextLayoutOptions['hyphenation'] {
    const frequency = node.props.android_hyphenationFrequency;
    if (this.kit.platform !== 'android' || (frequency !== 'normal' && frequency !== 'full')) return undefined;
    return { frequency, points: hyphenationPoints };
  }

  inputTextStyle(node: HostNode): TextStyle {
    // The input's backgroundColor paints its box, never a highlight behind the text.
    const style = { ...node.computed, backgroundColor: undefined };
    return resolveTextStyle(style, this.textEnvironment, node, node.props.allowFontScaling !== false, node.props.maxFontSizeMultiplier);
  }

  inputLayout(node: HostNode, text: string, width: number): TextLayout {
    const style = this.inputTextStyle(node);
    return layoutText([{ text: text || ' ', style }], node.props.multiline ? width : Infinity, {}, this.measurer);
  }

  /** Yoga measure function for leaf nodes. */
  measureLeaf(node: HostNode, maxWidth: number): { width: number; height: number } {
    switch (node.kind) {
      case 'text': {
        const layout = this.textLayoutFor(node, maxWidth);
        return { width: layout.width, height: layout.height };
      }
      case 'input': {
        const value = this.behaviors.inputValue(node) || String(node.props.placeholder ?? '');
        const layout = this.inputLayout(node, value, maxWidth);
        const lines = node.props.multiline ? Math.max(1, layout.lines.length, node.props.numberOfLines ?? 1) : 1;
        const lineHeight = layout.lines[0]?.height ?? 17;
        return { width: Math.min(layout.width, maxWidth), height: lineHeight * lines };
      }
      case 'switch':
        return { width: this.kit.switchSize.width, height: this.kit.switchSize.height };
      case 'activity': {
        const s = this.kit.activitySize(node.props.size);
        return { width: s, height: s };
      }
      case 'image': {
        const source = node.props.source;
        const s = Array.isArray(source) ? source[0] : source;
        if (s && typeof s === 'object' && typeof s.width === 'number' && typeof s.height === 'number') {
          return { width: s.width, height: s.height };
        }
        return { width: 0, height: 0 };
      }
      default:
        return { width: 0, height: 0 };
    }
  }

  // ── errors & logs ─────────────────────────────────────────────────────

  reportError(error: unknown, kind: EngineError['kind'], componentStack?: string): void {
    this.kernel.reportError(error, kind, componentStack);
  }

  warnOnce(key: string, message: string): void {
    this.kernel.warnOnce(key, message);
  }

  // ── inspection & test queries ─────────────────────────────────────────

  inspect(): InspectorNode | null {
    const build = (node: HostNode): InspectorNode => {
      const r = this.geometry.windowRect(node);
      const props: Record<string, unknown> = {};
      for (const key of ['testID', 'nativeID', 'accessibilityLabel', 'accessibilityRole']) {
        if (node.props[key] != null) props[key] = node.props[key];
      }
      if (node.kind === 'raw-text') props.text = node.text;
      if (Object.keys(node.style).length) props.style = summarizeStyle(node.computed);
      return {
        id: node.id,
        type: node.kind === 'raw-text' ? '#text' : node.type,
        component: componentName(node.fiber),
        rect: { x: r.x, y: r.y, w: r.w, h: r.h },
        props,
        children: node.children.map(build),
      };
    };
    return build(this.appRoot.root);
  }

  query(selector: SerializedSelector): Array<{ id: number; rect: { x: number; y: number; w: number; h: number } }> {
    const out: Array<{ id: number; rect: { x: number; y: number; w: number; h: number } }> = [];
    const matches = (node: HostNode): boolean => {
      if ('nodeId' in selector) return node.id === selector.nodeId;
      if ('testID' in selector) return node.props.testID === selector.testID;
      if ('label' in selector) return node.props.accessibilityLabel === selector.label || node.props['aria-label'] === selector.label;
      if ('text' in selector) {
        if (node.kind !== 'text') return false;
        const content = textContent(node);
        return selector.regex ? new RegExp(selector.text).test(content) : content === selector.text;
      }
      return false;
    };
    const roots = [this.appRoot.root, ...this.visibleModals(), this.systemRoot.root];
    for (const root of roots) {
      root.walk((node) => {
        if (node.hidden || node.computed.display === 'none') return false;
        if (matches(node)) {
          const r = this.geometry.windowRect(node);
          out.push({ id: node.id, rect: { x: r.x, y: r.y, w: r.w, h: r.h } });
        }
        return node.kind !== 'modal' || node === root;
      });
    }
    return out;
  }

  /** Compact layout tree for snapshot tests: [type, x, y, w, h, text?, children]. */
  dumpLayout(node: HostNode = this.appRoot.root): unknown {
    const round = (n: number) => Math.round(n * 100) / 100;
    const entry: Record<string, unknown> = {
      type: node.type.replace(/^m-/, ''),
      frame: [round(node.x), round(node.y), round(node.w), round(node.h)],
    };
    if (node.kind === 'text') entry.text = textContent(node);
    if (node.props.testID) entry.testID = node.props.testID;
    const children = node.children.filter((c) => c.kind !== 'raw-text' && c.kind !== 'virtual-text').map((c) => this.dumpLayout(c));
    if (children.length) entry.children = children;
    return entry;
  }

  destroy(): void {
    this.kernel.destroy();
    try {
      renderInto(this.appRoot, null);
      renderInto(this.systemRoot, null);
    } catch {
      // ignore teardown errors
    }
  }

  get stats() {
    return this.kernel.stats;
  }
}

export function textContent(node: HostNode): string {
  let s = '';
  node.walk((n) => {
    if (n.kind === 'raw-text' && !n.hidden) s += n.text;
  });
  return s;
}

function componentName(fiber: unknown): string | undefined {
  let f = fiber as { type?: unknown; return?: unknown } | null;
  for (let i = 0; f && i < 20; i++) {
    const type = f.type as { displayName?: string; name?: string } | string | undefined;
    if (typeof type === 'function' || (type && typeof type === 'object')) {
      const t = type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
      const name = t.displayName ?? t.name ?? t.render?.displayName ?? t.render?.name;
      if (name) return name;
    }
    f = f.return as typeof f;
  }
  return undefined;
}

function summarizeStyle(style: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || typeof v === 'function') continue;
    out[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}

