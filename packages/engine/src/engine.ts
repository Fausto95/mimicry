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
import { Behaviors } from './behaviors';
import { EnvironmentStore } from './environment';
import { EventDispatcher } from './events';
import { FocusManager } from './focus';
import { Geometry } from './geometry';
import { ImageStore } from './images';
import { hitTest } from './input/hit-test';
import { PointerInput } from './input/pointer';
import { GestureArena } from './input/gestures/arena';
import { ScrollManager } from './input/scroll';
import { runLayout } from './layout/layout';
import { FramePainter } from './paint/painter';
import { androidKit } from './platform/android';
import { iosKit } from './platform/ios';
import type { PlatformKit } from './platform/kit';
import { Animator } from './runtime/animator';
import type { Clock } from './runtime/clock';
import { parseColor, type ColorContext } from './style/color';
import type { Matrix } from './style/matrix';
import { NO_CLIP, type ClipSpec } from '@mimicry/protocol';
import type { TextMeasurer } from './text/measurer';
import { collectSpans, resolveTextStyle, type TextEnvironment } from './text/spans';
import { layoutText, type TextLayout, type TextLayoutOptions, type TextStyle } from './text/text-layout';
import { hyphenationPoints } from './text/text-block';
import { HostNode } from './tree/node';
import { batchedUpdates, createFiberRoot, renderInto, type RootContainer } from './tree/reconciler';

export interface EngineOptions {
  yoga: Yoga;
  measurer: TextMeasurer;
  environment: EnvironmentSpec;
  clock: Clock;
  send: (message: EngineMessage, transfer?: Transferable[]) => void;
  /** use only the fonts Mimicry ships (deterministic screenshots) */
  bundledFonts?: boolean;
  /**
   * The host mounts real text inputs over the canvas (browser). Headless
   * hosts have none, so the engine draws focused inputs and their caret.
   */
  hostInputs?: boolean;
  /**
   * Makes a font available to the engine's text measurer (a FontFace in the
   * worker, a registered file headless). The host is told separately so its
   * canvas can draw it.
   */
  loadFont?: (family: string, url: string, descriptors: { weight?: string; style?: string }) => Promise<void>;
  /** the host drains `engine.flushDeferred()` itself (headless tests, inside act) */
  manualDefer?: boolean;
}

export interface EngineHooks {
  /** shows a RedBox / LogBox; provided by @mimicry/react-native */
  onError?: (error: EngineError) => void;
  /** Android hardware back; returns true when handled */
  onBack?: () => boolean;
  capabilities?: () => Record<string, CapabilityLevel>;
}

/**
 * The engine: a React renderer over a retained view tree, Yoga layout,
 * platform kits and a painter that emits the binary frame protocol. It has
 * no DOM dependency — it runs in a Web Worker in the browser and directly in
 * Node for headless tests.
 */
export class Engine {
  readonly yoga: Yoga;
  readonly yogaConfig: YogaConfig;
  readonly measurer: TextMeasurer;
  readonly env: EnvironmentStore;
  readonly clock: Clock;
  readonly animator = new Animator();
  readonly geometry: Geometry;
  readonly events: EventDispatcher;
  readonly images: ImageStore;
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
  readonly hooks: EngineHooks = {};
  readonly bundledFonts: boolean;
  readonly hostInputs: boolean;
  kit: PlatformKit;

  private readonly painter: FramePainter;
  private readonly sendMessage: EngineOptions['send'];
  private frameRequested = false;
  private needsLayout = true;
  private needsPaint = true;
  private colorCache: ColorContext | null = null;
  private readonly warned = new Set<string>();
  private lastFrameTime = 0;
  private framesPainted = 0;
  private destroyed = false;
  private rootBackground: number | null = null;
  private readonly deferred: Array<() => void> = [];
  private deferScheduled = false;
  private readonly manualDefer: boolean;
  private readonly fonts = new Set<string>();
  private readonly fontLoader: EngineOptions['loadFont'];

  constructor(options: EngineOptions) {
    this.yoga = options.yoga;
    this.measurer = options.measurer;
    this.clock = options.clock;
    this.sendMessage = options.send;
    this.bundledFonts = !!options.bundledFonts;
    this.hostInputs = options.hostInputs ?? false;
    this.fontLoader = options.loadFont;
    this.manualDefer = !!options.manualDefer;
    this.env = new EnvironmentStore(options.environment);
    this.kit = this.env.device.platform === 'ios' ? iosKit : androidKit;
    this.yogaConfig = this.yoga.Config.create();
    // React Native rounds layout to the physical pixel grid and runs Yoga in compatibility mode.
    this.yogaConfig.setPointScaleFactor(this.env.viewport.scale);
    this.yogaConfig.setErrata(Errata.All);
    this.yogaConfig.setUseWebDefaults(false);

    this.geometry = new Geometry(this);
    this.events = new EventDispatcher((error) => this.reportError(error, 'runtime'));
    this.images = new ImageStore(this);
    this.focus = new FocusManager(this);
    this.behaviors = new Behaviors(this);
    this.scrolls = new ScrollManager(this);
    this.input = new PointerInput(this);
    this.gestures = new GestureArena(this);
    this.painter = new FramePainter(this);

    this.appRoot = this.createContainer('app');
    this.systemRoot = this.createContainer('system');
    this.env.subscribe((_env, changed) => this.environmentChanged(changed));
  }

  private createContainer(name: 'app' | 'system'): RootContainer {
    const root = new HostNode(this, 'm-root', 'root', { style: { flex: 1 } });
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
    if (!this.destroyed) this.sendMessage(message, transfer);
  }

  handle(message: HostMessage): void {
    switch (message.type) {
      case 'frame':
        this.frame(message.time);
        break;
      case 'pointer':
        this.input.handle(message.phase, message.id, message.x, message.y, message.time);
        this.requestFrame();
        break;
      case 'wheel':
        this.input.wheel(message.x, message.y, message.dx, message.dy);
        break;
      case 'textChange': {
        const node = this.nodes.get(message.nodeId);
        if (node) this.behaviors.textChanged(node, message.text, message.selection);
        break;
      }
      case 'textEvent': {
        const node = this.nodes.get(message.nodeId);
        if (node) this.focus.hostEvent(node, message.event, message.key);
        break;
      }
      case 'environment':
        this.env.update(message.environment);
        break;
      case 'imageLoaded':
        this.images.loaded(message.uri, message.width, message.height);
        break;
      case 'imageFailed':
        this.images.failed(message.uri, message.error);
        break;
      case 'inspect':
        this.send({ type: 'inspectResult', requestId: message.requestId, tree: this.inspect() });
        break;
      case 'hitTest': {
        const path = hitTest(this, message.x, message.y);
        this.send({ type: 'hitTestResult', requestId: message.requestId, nodeId: path?.at(-1)?.id ?? null, path: path?.map((n) => n.id) ?? [] });
        break;
      }
      case 'query':
        this.send({ type: 'queryResult', requestId: message.requestId, nodes: this.query(message.selector) });
        break;
      case 'back':
        this.back();
        break;
      case 'animationScale':
        this.animator.timeScale = Math.max(0.05, message.factor);
        break;
      default:
        // boot/hmr/reload are handled by the runtime that owns the module system
        break;
    }
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

  // ── frame pipeline ────────────────────────────────────────────────────

  requestFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    this.send({ type: 'requestFrame' });
  }

  get frameIsRequested(): boolean {
    return this.frameRequested;
  }

  invalidateLayout(): void {
    this.needsLayout = true;
    this.needsPaint = true;
    this.requestFrame();
  }

  markPaint(): void {
    this.needsPaint = true;
    this.requestFrame();
  }

  /**
   * One frame: animations (app rAF callbacks, Animated, scroll physics,
   * control transitions) → layout if dirty → paint → send.
   */
  frame(time: number): void {
    this.frameRequested = false;
    this.lastFrameTime = time;
    this.animator.advanceTo(time);
    this.animator.runCallbacks(time, (fn) => batchedUpdates(fn));
    this.animator.step(time);
    let layoutMs = 0;
    if (this.needsLayout) {
      const t0 = now();
      this.layout();
      layoutMs = now() - t0;
    }
    if (this.needsPaint) {
      this.needsPaint = false;
      const t1 = now();
      const { buffer, stats } = this.painter.paint();
      const paintMs = now() - t1;
      this.framesPainted++;
      this.send(
        {
          type: 'frame',
          buffer,
          stats: {
            frame: this.framesPainted,
            layoutMs,
            paintMs,
            bytes: buffer.byteLength,
            chunks: stats.chunks,
            layers: stats.layers,
            nodes: this.nodes.size,
            live: this.animator.liveCount,
          },
        },
        [buffer],
      );
    }
    if (this.animator.busy) this.requestFrame();
  }

  /** Paint immediately and return the frame (headless screenshots). */
  paintNow(): ArrayBuffer {
    if (this.needsLayout) this.layout();
    this.needsPaint = false;
    return this.painter.paint().buffer;
  }

  private layout(): void {
    this.needsLayout = false;
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
   * (onLayout, onLoad from cache). A microtask in the browser; a headless
   * host (option `manualDefer`) drains the queue itself inside act(), so
   * state set from these callbacks lands deterministically on virtual time.
   */
  defer(fn: () => void): void {
    this.deferred.push(fn);
    if (this.manualDefer || this.deferScheduled) return;
    this.deferScheduled = true;
    queueMicrotask(() => {
      this.deferScheduled = false;
      this.flushDeferred();
    });
  }

  get hasDeferred(): boolean {
    return this.deferred.length > 0;
  }

  flushDeferred(): void {
    while (this.deferred.length) {
      const batch = this.deferred.splice(0);
      for (const fn of batch) fn();
    }
  }

  /** Called by the reconciler after every commit, before layout effects run. */
  afterCommit(_root: RootContainer): void {
    if (this.needsLayout) this.layout();
    this.needsPaint = true;
    this.requestFrame();
  }

  // ── tree bookkeeping ──────────────────────────────────────────────────

  onNodeChanged(_node: HostNode): void {
    this.needsPaint = true;
    this.requestFrame();
  }

  onAttach(node: HostNode): void {
    const parentMounted = node.parent?.mounted ?? false;
    if (!parentMounted) return;
    node.walk((n) => {
      if (!n.mounted) {
        n.mounted = true;
        this.nodes.set(n.id, n);
        if (n.kind === 'modal') this.modals.add(n);
        if (n.props.safeAreaEdges) this.safeAreaNodes.add(n);
        this.behaviors.attached(n);
      }
    });
  }

  onDetach(node: HostNode): void {
    node.walk((n) => {
      if (n.mounted) {
        n.mounted = false;
        this.modals.delete(n);
        this.safeAreaNodes.delete(n);
        this.behaviors.detached(n);
        if (this.focus.focused === n) this.focus.blur(n);
      }
    });
  }

  onDestroy(node: HostNode): void {
    this.nodes.delete(node.id);
    this.modals.delete(node);
    this.safeAreaNodes.delete(node);
    this.inlineViews.delete(node);
    this.images.forget(node);
    this.scrolls.release(node);
    this.gestures.nodeDestroyed(node);
  }

  visibleModals(): HostNode[] {
    return Array.from(this.modals).filter((m) => m.mounted && this.behaviors.isModalShown(m));
  }

  get presentation(): { matrix: Matrix; clip: ClipSpec; radius: number } | null {
    const p = this.behaviors.presentingTransform();
    return p ? { matrix: p.matrix, clip: NO_CLIP, radius: p.radius } : null;
  }

  // ── environment ───────────────────────────────────────────────────────

  private environmentChanged(changed: { dimensions: boolean; appearance: boolean; device: boolean }): void {
    if (changed.device) {
      this.kit = this.env.device.platform === 'ios' ? iosKit : androidKit;
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
    await this.fontLoader?.(family, url, descriptors);
    this.send({ type: 'loadFont', family, url, weight: descriptors.weight, style: descriptors.style });
    this.fonts.add(family);
    this.measurer.invalidate?.();
    for (const node of this.nodes.values()) if (node.kind === 'text' || node.kind === 'input') node.invalidateText();
    this.invalidateLayout();
  }

  loadedFonts(): string[] {
    return Array.from(this.fonts);
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
    const e = error instanceof Error ? error : new Error(String(error));
    const payload: EngineError = { kind, message: e.message, stack: e.stack, componentStack };
    this.send({ type: 'error', error: payload });
    try {
      this.hooks.onError?.(payload);
    } catch {
      // the error UI must never take the engine down
    }
  }

  warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.send({ type: 'log', level: 'warn', message: `[mimicry] ${message}` });
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
    this.destroyed = true;
    try {
      renderInto(this.appRoot, null);
      renderInto(this.systemRoot, null);
    } catch {
      // ignore teardown errors
    }
  }

  get stats() {
    return { frames: this.framesPainted, lastFrameTime: this.lastFrameTime };
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

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
