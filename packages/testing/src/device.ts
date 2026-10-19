import { createCanvas, GlobalFonts, loadImage, type Image as NapiImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CanvasTextMeasurer, Kernel, VirtualClock } from '@mimicry/os-core';
import { IOS } from '@mimicry/os-ios';
import { Android } from '@mimicry/os-android';
import { Compositor } from '@mimicry/host-web';
import { decodeFrame, getDevice, type Appearance, type DeviceDescriptor, type EngineMessage, type Orientation } from '@mimicry/protocol';
import { bundledFonts } from '@mimicry/compiler';

/**
 * A bare simulated device: a kernel and its OS (iOS or Android) on a
 * virtual clock, with no framework on top. Tests drive the OS's own APIs
 * (UIKit, the View system) and read pixels back, the way a native unit
 * test would — and framework adapters other than React Native start here.
 */
export interface DeviceOptions {
  device?: string | DeviceDescriptor;
  appearance?: Appearance;
  orientation?: Orientation;
  fontScale?: number;
  /** frame interval in ms (default 1000/60) */
  frameInterval?: number;
  /** a browser-like host that draws focused text fields itself */
  hostInputs?: boolean;
}

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const font of bundledFonts()) GlobalFonts.registerFromPath(font.file, font.family);
}

export class Device {
  readonly messages: EngineMessage[] = [];
  readonly logs: string[] = [];
  private readonly images = new Map<string, NapiImage>();
  private readonly pending = new Set<Promise<void>>();
  private readonly compositor: Compositor;
  private readonly interval: number;
  private pointerId = 1;

  constructor(readonly kernel: Kernel, readonly os: IOS | Android, readonly clock: VirtualClock, options: DeviceOptions) {
    this.interval = options.frameInterval ?? 1000 / 60;
    this.compositor = new Compositor({
      canvases: { create: (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)) as any },
      images: { get: (uri) => (this.images.get(uri) as unknown as CanvasImageSource) ?? null },
      cacheBudget: 256 * 1024 * 1024,
    });
  }

  /** @internal */
  receive(message: EngineMessage): void {
    this.messages.push(message);
    if (this.messages.length > 500) this.messages.splice(0, 100);
    if (message.type === 'log') this.logs.push(`${message.level}: ${message.message}`);
    if (message.type === 'loadImage') this.loadImage(message.uri);
  }

  get ios(): IOS {
    if (!(this.os instanceof IOS)) throw new Error('not an iOS device');
    return this.os;
  }

  get android(): Android {
    if (!(this.os instanceof Android)) throw new Error('not an Android device');
    return this.os;
  }

  private loadImage(uri: string): void {
    const p = (async () => {
      try {
        const bytes = await imageBytes(uri);
        if (!bytes) throw new Error(`cannot load ${uri}`);
        const img = await loadImage(bytes);
        this.images.set(uri, img);
        this.kernel.handle({ type: 'imageLoaded', uri, width: img.width, height: img.height });
      } catch (error) {
        this.kernel.handle({ type: 'imageFailed', uri, error: String((error as Error).message ?? error) });
      }
    })();
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Wait for images, then run deferred work. */
  async ready(): Promise<this> {
    for (let i = 0; i < 10 && this.pending.size; i++) await Promise.all(Array.from(this.pending));
    this.kernel.flushDeferred();
    return this.advance(this.interval);
  }

  private lastFrame = 0;

  /** Advance virtual time: timers fire on time, a frame renders on every vsync that was asked for. */
  advance(ms: number): this {
    const end = this.clock.now() + ms;
    const run = (fn: () => void) => {
      fn();
      this.kernel.flushDeferred();
    };
    for (;;) {
      const nextFrame = this.lastFrame + this.interval;
      if (nextFrame > end) break;
      this.clock.runUntil(nextFrame, run);
      this.lastFrame = nextFrame;
      if (this.kernel.frameIsRequested) run(() => this.kernel.frame(nextFrame));
    }
    this.clock.runUntil(end, run);
    return this;
  }

  /** Run frames until nothing animates (or `maxMs` passes). */
  settle(maxMs = 5000): this {
    const start = this.clock.now();
    do {
      this.advance(this.interval);
    } while ((this.kernel.frameIsRequested || this.kernel.animator.busy) && this.clock.now() - start < maxMs);
    return this;
  }

  pointer(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, id = this.pointerId): this {
    this.kernel.handle({ type: 'pointer', phase, id, x, y, time: this.clock.now() });
    this.kernel.flushDeferred();
    return this;
  }

  tap(x: number, y: number, holdMs = 50): this {
    this.pointer('down', x, y);
    this.advance(holdMs);
    this.pointer('up', x, y);
    this.pointerId++;
    return this.advance(this.interval);
  }

  drag(x: number, y: number, dx: number, dy: number, options: { duration?: number; steps?: number } = {}): this {
    const steps = options.steps ?? 12;
    const duration = options.duration ?? 200;
    this.pointer('down', x, y);
    for (let i = 1; i <= steps; i++) {
      this.advance(duration / steps);
      this.pointer('move', x + (dx * i) / steps, y + (dy * i) / steps);
    }
    this.pointer('up', x + dx, y + dy);
    this.pointerId++;
    return this.advance(this.interval);
  }

  back(): this {
    this.kernel.handle({ type: 'back' });
    return this.advance(this.interval);
  }

  /** Render the current state to PNG at the device's pixel density (or `scale`). */
  screenshot(scale = this.kernel.viewport.scale): Buffer {
    const v = this.kernel.viewport;
    const frame = decodeFrame(this.kernel.paintNow());
    const device = createCanvas(Math.round(v.width * v.scale), Math.round(v.height * v.scale));
    this.compositor.paint(device.getContext('2d') as any, frame, v.scale, device.width, device.height);
    if (Math.abs(scale - v.scale) < 1e-6) return device.toBuffer('image/png');
    const out = createCanvas(Math.round(v.width * scale), Math.round(v.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(device, 0, 0, out.width, out.height);
    return out.toBuffer('image/png');
  }
}

async function imageBytes(uri: string): Promise<Buffer | null> {
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

/** Boot a bare device: kernel + OS on a virtual clock, bundled fonts, no framework. */
export function createDevice(options: DeviceOptions = {}): Device {
  registerFonts();
  const descriptor = typeof options.device === 'string' ? getDevice(options.device) : options.device ?? getDevice('iphone-17-pro');
  const clock = new VirtualClock(0);
  const measure = createCanvas(8, 8).getContext('2d');
  let device: Device | null = null;
  const queue: EngineMessage[] = [];
  const kernel = new Kernel({
    measurer: new CanvasTextMeasurer(measure as any),
    clock,
    bundledFonts: true,
    hostInputs: options.hostInputs ?? false,
    manualDefer: true,
    environment: { device: descriptor, orientation: options.orientation ?? 'portrait', appearance: options.appearance ?? 'light', fontScale: options.fontScale },
    send: (m) => (device ? device.receive(m) : queue.push(m)),
  });
  const os = descriptor.platform === 'ios' ? new IOS(kernel) : new Android(kernel);
  device = new Device(kernel, os, clock, options);
  for (const m of queue) device.receive(m);
  return device;
}
