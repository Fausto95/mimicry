import { act, type ReactNode } from 'react';
import { createCanvas, GlobalFonts, loadImage, type Image as NapiImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CanvasTextMeasurer, Engine, VirtualClock, loadYoga,
} from '@mimicry/engine';
import { Compositor } from '@mimicry/host-web';
import { installReactNative, setActiveEngine } from '@mimicry/react-native';
import {
  decodeFrame, getDevice, type Appearance, type DeviceDescriptor, type EngineError, type EngineMessage,
  type EnvironmentSpec, type Orientation, type SerializedSelector,
} from '@mimicry/protocol';
import { bundledFonts } from '@mimicry/compiler';
import { installRefresh } from '@mimicry/runtime';

// React Refresh must hook in before the first renderer registers itself.
installRefresh();

/**
 * Headless sessions: the engine runs in-process on a virtual clock and the
 * same compositor the browser uses paints into @napi-rs/canvas with the
 * bundled fonts. Every frame is reproducible, which is what golden images,
 * filmstrips and layout-tree diffs rely on.
 */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const font of bundledFonts()) GlobalFonts.registerFromPath(font.file, font.family);
}

export interface SessionOptions {
  device?: string | DeviceDescriptor;
  appearance?: Appearance;
  orientation?: Orientation;
  fontScale?: number;
  /** pixels per point for screenshots (defaults to the device scale) */
  screenshotScale?: number;
  /** frame interval in ms (default 1000/60) */
  frameInterval?: number;
  /** resolves image URIs (default: file paths, file:// and data: URIs) */
  loadImageBytes?: (uri: string) => Promise<Buffer | null>;
}

export type Target = SerializedSelector | { x: number; y: number } | { testID: string } | { text: string | RegExp } | { label: string };

export interface FilmstripFrame {
  time: number;
  png: Buffer;
}

export class Session {
  readonly engine: Engine;
  readonly clock: VirtualClock;
  readonly messages: EngineMessage[] = [];
  readonly errors: EngineError[] = [];
  readonly logs: string[] = [];
  private readonly images = new Map<string, NapiImage>();
  private readonly pendingImages = new Set<Promise<void>>();
  private readonly compositor: Compositor;
  private readonly interval: number;
  private lastFrame = 0;
  private pointerId = 1;

  constructor(engine: Engine, clock: VirtualClock, private readonly options: SessionOptions) {
    this.engine = engine;
    this.clock = clock;
    this.interval = options.frameInterval ?? 1000 / 60;
    this.compositor = new Compositor({
      canvases: { create: (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)) as any },
      images: { get: (uri) => (this.images.get(uri) as unknown as CanvasImageSource) ?? null },
      cacheBudget: 512 * 1024 * 1024,
    });
  }

  /** @internal */
  receive(message: EngineMessage): void {
    this.messages.push(message);
    if (this.messages.length > 500) this.messages.splice(0, 100);
    if (message.type === 'error') this.errors.push(message.error);
    if (message.type === 'log') this.logs.push(`${message.level}: ${message.message}`);
    if (message.type === 'loadImage') this.loadImage(message.uri);
  }

  private loadImage(uri: string): void {
    const p = (async () => {
      try {
        const bytes = this.options.loadImageBytes ? await this.options.loadImageBytes(uri) : await defaultImageBytes(uri);
        if (!bytes) throw new Error(`cannot load ${uri}`);
        const img = await loadImage(bytes);
        this.images.set(uri, img);
        act(() => this.engine.handle({ type: 'imageLoaded', uri, width: img.width, height: img.height }));
      } catch (error) {
        act(() => this.engine.handle({ type: 'imageFailed', uri, error: String((error as Error).message ?? error) }));
      }
    })();
    this.pendingImages.add(p);
    void p.finally(() => this.pendingImages.delete(p));
  }

  get time(): number {
    return this.clock.now();
  }

  /** Advance virtual time, running timers and frames exactly as a device would. */
  advance(ms: number): this {
    const end = this.clock.now() + ms;
    for (;;) {
      const nextFrame = this.lastFrame + this.interval;
      if (nextFrame > end) break;
      this.clock.runUntil(nextFrame, (fn) => act(fn));
      this.lastFrame = nextFrame;
      if (this.engine.frameIsRequested) act(() => this.engine.frame(nextFrame));
    }
    this.clock.runUntil(end, (fn) => act(fn));
    return this;
  }

  /** Advance until nothing is animating (or `maxMs` passes). */
  settle(maxMs = 5000): this {
    const start = this.clock.now();
    do {
      this.advance(this.interval);
    } while ((this.engine.frameIsRequested || this.engine.animator.busy) && this.clock.now() - start < maxMs);
    return this;
  }

  /** Wait for images, then settle. */
  async ready(maxMs = 5000): Promise<this> {
    this.settle(maxMs);
    for (let i = 0; i < 10 && this.pendingImages.size; i++) {
      await Promise.all(Array.from(this.pendingImages));
      this.settle(maxMs);
    }
    return this;
  }

  find(target: Target): Array<{ id: number; rect: { x: number; y: number; w: number; h: number } }> {
    if ('x' in target && 'y' in target) return [{ id: -1, rect: { x: target.x, y: target.y, w: 0, h: 0 } }];
    let selector: SerializedSelector;
    if ('text' in target && target.text instanceof RegExp) selector = { text: target.text.source, regex: true };
    else selector = target as SerializedSelector;
    return this.engine.query(selector);
  }

  private point(target: Target): { x: number; y: number } {
    if ('x' in target && 'y' in target) return target;
    const found = this.find(target);
    if (!found.length) throw new Error(`No element matches ${JSON.stringify(target, (_k, v) => (v instanceof RegExp ? String(v) : v))}`);
    const r = found[found.length - 1]!.rect;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  pointer(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, id = this.pointerId): this {
    act(() => this.engine.handle({ type: 'pointer', phase, id, x, y, time: this.clock.now() }));
    return this;
  }

  /** Tap: down, ~50ms, up — then let the frame render. */
  tap(target: Target, holdMs = 50): this {
    const p = this.point(target);
    this.pointer('down', p.x, p.y);
    this.advance(holdMs);
    this.pointer('up', p.x, p.y);
    this.pointerId++;
    return this.advance(this.interval);
  }

  longPress(target: Target, holdMs = 600): this {
    return this.tap(target, holdMs);
  }

  /** Drag with intermediate moves (a real finger, not a teleport). */
  drag(from: Target, to: { dx: number; dy: number } | Target, options: { duration?: number; steps?: number } = {}): this {
    const a = this.point(from);
    const b = 'dx' in to ? { x: a.x + to.dx, y: a.y + to.dy } : this.point(to);
    const steps = options.steps ?? 12;
    const duration = options.duration ?? 200;
    this.pointer('down', a.x, a.y);
    for (let i = 1; i <= steps; i++) {
      this.advance(duration / steps);
      const t = i / steps;
      this.pointer('move', a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
    this.pointer('up', b.x, b.y);
    this.pointerId++;
    return this.advance(this.interval);
  }

  /** Swipe to scroll content by `dy` (positive scrolls down). */
  scroll(target: Target, delta: { dx?: number; dy?: number }, options?: { duration?: number }): this {
    return this.drag(target, { dx: -(delta.dx ?? 0), dy: -(delta.dy ?? 0) }, options);
  }

  /** Type into a TextInput (focuses it first). */
  type(target: Target, text: string): this {
    const found = this.find(target);
    const id = found[found.length - 1]?.id;
    const node = id != null ? this.engine.nodes.get(id) : undefined;
    if (!node || node.kind !== 'input') throw new Error('type(): target is not a TextInput');
    act(() => node.focus());
    let value = this.engine.behaviors.inputValue(node);
    for (const ch of text) {
      value += ch;
      act(() => this.engine.handle({ type: 'textChange', nodeId: node.id, text: value }));
      this.advance(this.interval);
    }
    return this;
  }

  submit(target: Target): this {
    const id = this.find(target).at(-1)?.id;
    if (id != null) act(() => this.engine.handle({ type: 'textEvent', nodeId: id, event: 'submit' }));
    return this.advance(this.interval);
  }

  back(): this {
    act(() => this.engine.handle({ type: 'back' }));
    return this.advance(this.interval);
  }

  setEnvironment(env: Partial<EnvironmentSpec> & { device?: DeviceDescriptor | string }): this {
    const next: Partial<EnvironmentSpec> = { ...env, device: typeof env.device === 'string' ? getDevice(env.device) : env.device };
    if (!next.device) delete next.device;
    act(() => this.engine.handle({ type: 'environment', environment: next }));
    return this.advance(this.interval);
  }

  text(target: Target): string[] {
    return this.find(target).map((f) => {
      const node = this.engine.nodes.get(f.id);
      let s = '';
      node?.walk((n) => {
        if (n.kind === 'raw-text') s += n.text;
      });
      return s;
    });
  }

  exists(target: Target): boolean {
    return this.find(target).length > 0;
  }

  /** Compact layout tree (for snapshot diffs). */
  layout(): unknown {
    return this.engine.dumpLayout();
  }

  /** Render the current state to PNG. */
  screenshot(scale = this.options.screenshotScale ?? this.engine.viewport.scale): Buffer {
    const v = this.engine.viewport;
    const frame = decodeFrame(this.engine.paintNow());
    // Rasterize at the device's own pixel density (like the simulator's
    // framebuffer), then resample if a different size was asked for.
    const device = createCanvas(Math.round(v.width * v.scale), Math.round(v.height * v.scale));
    this.compositor.paint(device.getContext('2d') as any, frame, v.scale, device.width, device.height);
    if (Math.abs(scale - v.scale) < 1e-6) return device.toBuffer('image/png');
    const out = createCanvas(Math.round(v.width * scale), Math.round(v.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(device, 0, 0, out.width, out.height);
    return out.toBuffer('image/png');
  }

  /**
   * Filmstrip: tick the virtual clock in fixed steps, sample frames, and fire
   * actions at exact times. Same inputs → same frames, every run.
   */
  filmstrip(options: {
    duration: number;
    every: number;
    scale?: number;
    actions?: Array<{ at: number; run: (s: Session) => void }>;
  }): FilmstripFrame[] {
    const frames: FilmstripFrame[] = [];
    const start = this.clock.now();
    const actions = (options.actions ?? []).slice().sort((a, b) => a.at - b.at);
    for (let t = 0; t <= options.duration; t += options.every) {
      while (actions.length && actions[0]!.at <= t) actions.shift()!.run(this);
      const target = start + t;
      if (target > this.clock.now()) this.advance(target - this.clock.now());
      frames.push({ time: t, png: this.screenshot(options.scale) });
    }
    return frames;
  }

  dispose(): void {
    act(() => this.engine.destroy());
    setActiveEngine(null);
  }
}

async function defaultImageBytes(uri: string): Promise<Buffer | null> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    const meta = uri.slice(5, comma);
    const body = uri.slice(comma + 1);
    return meta.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body));
  }
  if (uri.startsWith('file://')) return readFile(fileURLToPath(uri));
  if (uri.startsWith('/')) return readFile(uri);
  return null;
}

/** Create an engine wired for headless use (fonts, measurer, virtual clock). */
export async function createHeadlessEngine(options: SessionOptions = {}): Promise<Session> {
  registerFonts();
  const yoga = await loadYoga();
  const device = typeof options.device === 'string' ? getDevice(options.device) : options.device ?? getDevice('iphone-17-pro');
  const clock = new VirtualClock(0);
  const measure = createCanvas(8, 8).getContext('2d');
  let session: Session | null = null;
  const queue: EngineMessage[] = [];
  const engine = new Engine({
    yoga,
    measurer: new CanvasTextMeasurer(measure as any),
    clock,
    bundledFonts: true,
    environment: {
      device,
      orientation: options.orientation ?? 'portrait',
      appearance: options.appearance ?? 'light',
      fontScale: options.fontScale,
    },
    send: (m) => (session ? session.receive(m) : queue.push(m)),
  });
  session = new Session(engine, clock, options);
  for (const m of queue) session.receive(m);
  act(() => installReactNative(engine));
  return session;
}

/** Render a React element headlessly. */
export async function render(element: ReactNode, options: SessionOptions = {}): Promise<Session> {
  const session = await createHeadlessEngine(options);
  act(() => session.engine.render(element));
  await session.ready();
  return session;
}
