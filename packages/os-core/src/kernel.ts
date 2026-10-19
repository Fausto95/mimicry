import type {
  CapabilityLevel, EngineError, EngineMessage, EnvironmentSpec, HostMessage, Viewport,
} from '@mimicry/protocol';
import { Animator } from './animation/animator';
import type { Clock } from './animation/clock';
import { Display, RenderServer } from './render/render-server';
import type { LayerHost, RenderLayer } from './render/layer';
import { EnvironmentStore } from './services/environment';
import { ImageStore } from './services/images';
import type { TextMeasurer } from './text/measurer';

/**
 * The kernel: what every simulated device has regardless of its OS — a
 * display and its vsync, a touch digitizer, a clock, a GPU command stream
 * (the frame protocol), a font rasterizer, an image decoder, storage and a
 * keyboard (the host's text fields). It runs the frame loop
 *
 *   vsync → frame callbacks & animations → layout passes → render server → frame
 *
 * and routes host messages to whoever registered for them: the OS (touches,
 * text input, back), the framework adapter (inspection, test queries).
 */
export interface KernelOptions {
  measurer: TextMeasurer;
  environment: EnvironmentSpec;
  clock: Clock;
  send: (message: EngineMessage, transfer?: Transferable[]) => void;
  /** use only the fonts Mimicry ships (deterministic screenshots) */
  bundledFonts?: boolean;
  /**
   * The host mounts real text inputs over the canvas (browser). Headless
   * hosts have none, so text fields draw their own text and caret.
   */
  hostInputs?: boolean;
  /**
   * Makes a font available to the text measurer (a FontFace in a worker, a
   * registered file headless). The host is told separately so its canvas
   * can draw it.
   */
  loadFont?: (family: string, url: string, descriptors: { weight?: string; style?: string }) => Promise<void>;
  /** the host drains `flushDeferred()` itself (headless tests, inside act) */
  manualDefer?: boolean;
}

export interface KernelHooks {
  /** shows a RedBox / LogBox; provided by the framework adapter */
  onError?: (error: EngineError) => void;
  /** Android hardware back; returns true when handled */
  onBack?: () => boolean;
  capabilities?: () => Record<string, CapabilityLevel>;
}

type Handler<T extends HostMessage['type']> = (message: Extract<HostMessage, { type: T }>) => void;

export interface FrameStats {
  frame: number;
  layoutMs: number;
  paintMs: number;
  bytes: number;
  chunks: number;
  layers: number;
  nodes: number;
  live: number;
}

export class Kernel implements LayerHost {
  readonly env: EnvironmentStore;
  readonly clock: Clock;
  readonly measurer: TextMeasurer;
  readonly animator = new Animator();
  readonly images: ImageStore;
  readonly display: Display;
  readonly renderServer = new RenderServer();
  readonly hooks: KernelHooks = {};
  readonly bundledFonts: boolean;
  readonly hostInputs: boolean;

  /** run frame callbacks inside the framework's batching (React's batchedUpdates) */
  batch: (fn: () => void) => void = (fn) => fn();
  /** how many framework nodes exist (frame stats) */
  nodeCount: () => number = () => 0;

  private readonly sendMessage: KernelOptions['send'];
  private readonly handlers = new Map<string, Array<(message: any) => void>>();
  private readonly layoutPasses: Array<() => void> = [];
  private readonly beforePaint: Array<() => void> = [];
  private readonly beforeInput: Array<() => void> = [];
  private frameRequested = false;
  private painting = false;
  private needsLayout = true;
  private needsPaint = true;
  private lastFrameTime = 0;
  private framesPainted = 0;
  private destroyed = false;
  private readonly deferred: Array<() => void> = [];
  private deferScheduled = false;
  private readonly manualDefer: boolean;
  private readonly fonts = new Set<string>();
  private readonly fontLoader: KernelOptions['loadFont'];
  private readonly fontListeners = new Set<() => void>();
  private readonly warned = new Set<string>();

  constructor(options: KernelOptions) {
    this.measurer = options.measurer;
    this.clock = options.clock;
    this.sendMessage = options.send;
    this.bundledFonts = !!options.bundledFonts;
    this.hostInputs = options.hostInputs ?? false;
    this.fontLoader = options.loadFont;
    this.manualDefer = !!options.manualDefer;
    this.env = new EnvironmentStore(options.environment);
    const v = this.env.viewport;
    this.display = new Display(v.width, v.height, v.scale);
    this.images = new ImageStore({
      requestImage: (uri) => this.send({ type: 'loadImage', uri }),
      defer: (fn) => this.defer(fn),
      imagesChanged: () => this.setNeedsDisplay(),
    });
    this.env.subscribe(() => {
      const view = this.env.viewport;
      this.display.resize(view.width, view.height, view.scale);
    });
    this.on('frame', (m) => this.frame(m.time));
    this.on('environment', (m) => this.env.update(m.environment));
    this.on('imageLoaded', (m) => this.images.loaded(m.uri, m.width, m.height));
    this.on('imageFailed', (m) => this.images.failed(m.uri, m.error));
    this.on('animationScale', (m) => {
      this.animator.timeScale = Math.max(0.05, m.factor);
    });
  }

  get viewport(): Viewport {
    return this.env.viewport;
  }

  // ── messages ──────────────────────────────────────────────────────────

  /** Register for a host message (several handlers run in registration order). */
  on<T extends HostMessage['type']>(type: T, handler: Handler<T>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    };
  }

  handle(message: HostMessage): void {
    const list = this.handlers.get(message.type);
    if (!list) return;
    for (const handler of list.slice()) handler(message);
  }

  send(message: EngineMessage, transfer?: Transferable[]): void {
    if (!this.destroyed) this.sendMessage(message, transfer);
  }

  // ── frame loop ────────────────────────────────────────────────────────

  requestFrame(): void {
    if (this.frameRequested || this.destroyed) return;
    this.frameRequested = true;
    this.send({ type: 'requestFrame' });
  }

  get frameIsRequested(): boolean {
    return this.frameRequested;
  }

  setNeedsLayout(): void {
    // Mounting during a paint syncs what this very frame shows; it asks for nothing more.
    if (this.painting) return;
    this.needsLayout = true;
    this.needsPaint = true;
    this.requestFrame();
  }

  setNeedsDisplay(): void {
    if (this.painting) return;
    this.needsPaint = true;
    this.requestFrame();
  }

  layerNeedsDisplay(_layer: RenderLayer): void {
    this.setNeedsDisplay();
  }

  /** A layout pass (UIKit's layoutSubviews pass, Android's traversal, a framework's flexbox). */
  addLayoutPass(pass: () => void): void {
    this.layoutPasses.push(pass);
  }

  /** Runs right before every paint (mounting: framework state → layer properties). */
  addBeforePaint(fn: () => void): void {
    this.beforePaint.push(fn);
  }

  /** Runs before the OS routes an input event (frameworks mount pending changes). */
  addBeforeInput(fn: () => void): void {
    this.beforeInput.push(fn);
  }

  /** Bring geometry up to date before hit testing: pending layout, then mounting. */
  prepareInput(): void {
    this.layoutIfNeeded();
    for (const fn of this.beforeInput) fn();
  }

  /** Run pending layout now (before hit testing or measuring between frames). */
  layoutIfNeeded(): void {
    if (!this.needsLayout) return;
    this.needsLayout = false;
    for (const pass of this.layoutPasses) pass();
  }

  /**
   * One frame: frame callbacks and animations → layout if dirty → paint → send.
   */
  frame(time: number): void {
    this.frameRequested = false;
    this.lastFrameTime = time;
    this.animator.advanceTo(time);
    this.animator.runCallbacks(time, (fn) => this.batch(fn));
    this.animator.step(time);
    let layoutMs = 0;
    if (this.needsLayout) {
      const t0 = now();
      this.layoutIfNeeded();
      layoutMs = now() - t0;
    }
    if (this.needsPaint) {
      this.needsPaint = false;
      const t1 = now();
      const { buffer, stats } = this.paint();
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
            nodes: this.nodeCount(),
            live: this.animator.liveCount,
          } satisfies FrameStats,
        },
        [buffer],
      );
    }
    if (this.animator.busy) this.requestFrame();
  }

  private paint() {
    this.painting = true;
    try {
      for (const fn of this.beforePaint) fn();
      return this.renderServer.render(this.display);
    } finally {
      this.painting = false;
    }
  }

  /** Paint immediately and return the frame (headless screenshots). */
  paintNow(): ArrayBuffer {
    this.layoutIfNeeded();
    this.needsPaint = false;
    return this.paint().buffer;
  }

  get stats() {
    return { frames: this.framesPainted, lastFrameTime: this.lastFrameTime };
  }

  // ── deferred work (the run loop's "after this task") ──────────────────

  /**
   * Run `fn` after the current task, like UIKit's main-queue async work or a
   * posted Handler message (React Native's onLayout, onLoad from cache).
   * A microtask in the browser; a headless host (`manualDefer`) drains the
   * queue itself so callbacks land deterministically on virtual time.
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

  // ── fonts ─────────────────────────────────────────────────────────────

  /** Register a custom font. Resolves once text can measure with it. */
  async loadFont(family: string, url: string, descriptors: { weight?: string; style?: string } = {}): Promise<void> {
    await this.fontLoader?.(family, url, descriptors);
    this.send({ type: 'loadFont', family, url, weight: descriptors.weight, style: descriptors.style });
    this.fonts.add(family);
    this.measurer.invalidate?.();
    for (const listener of Array.from(this.fontListeners)) listener();
    this.setNeedsLayout();
  }

  loadedFonts(): string[] {
    return Array.from(this.fonts);
  }

  /** Called after a font loads: cached text layouts are stale. */
  onFontsChanged(listener: () => void): () => void {
    this.fontListeners.add(listener);
    return () => this.fontListeners.delete(listener);
  }

  // ── errors & logs ─────────────────────────────────────────────────────

  reportError(error: unknown, kind: EngineError['kind'], componentStack?: string): void {
    const e = error instanceof Error ? error : new Error(String(error));
    const payload: EngineError = { kind, message: e.message, stack: e.stack, componentStack };
    this.send({ type: 'error', error: payload });
    try {
      this.hooks.onError?.(payload);
    } catch {
      // the error UI must never take the kernel down
    }
  }

  warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.send({ type: 'log', level: 'warn', message: `[mimicry] ${message}` });
  }

  destroy(): void {
    this.destroyed = true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
