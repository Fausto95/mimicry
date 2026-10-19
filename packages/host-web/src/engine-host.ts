import {
  decodeFrame, type AppBundle, type EngineMessage, type EnvironmentSpec, type FontSpecRecord, type FrameStats,
  type HostMessage, type InspectorNode, type ModuleRecord, type Viewport, resolveViewport,
} from '@mimicry/protocol';
import { Compositor, type CompositorStats } from './compositor';
import { OVERLAY_CSS, OverlayLayer } from './overlays';

/**
 * The browser host: boots the engine worker (the base module), forwards
 * input, paints frames with the Compositor and keeps native inputs aligned.
 * The canvas backing store is always the device's own pixel grid; zoom is
 * CSS only, so what you see is the simulator's framebuffer, scaled.
 */
export interface EngineHostOptions {
  /** element the host fills with the canvas and overlay layer */
  container: HTMLElement;
  workerUrl: string;
  fonts: FontSpecRecord[];
  fontMode?: 'system' | 'bundled';
  onMessage?: (message: EngineMessage) => void;
  onFrame?: (stats: { engine: FrameStats; host: CompositorStats }) => void;
}

const fontFaces = new Set<string>();

async function loadDocumentFonts(fonts: FontSpecRecord[]): Promise<void> {
  await Promise.all(
    fonts.map(async (f) => {
      const key = `${f.family}:${f.weight}:${f.style}`;
      if (fontFaces.has(key)) return;
      fontFaces.add(key);
      try {
        const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight, style: f.style });
        document.fonts.add(face);
        await face.load();
      } catch {
        fontFaces.delete(key);
      }
    }),
  );
}

let styleInstalled = false;

export class EngineHost {
  readonly canvas: HTMLCanvasElement;
  readonly overlayRoot: HTMLDivElement;
  private worker: Worker | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly compositor: Compositor;
  private readonly overlays: OverlayLayer;
  private readonly images = new Map<string, HTMLImageElement>();
  private viewport: Viewport | null = null;
  private zoom = 1;
  private frameScheduled = false;
  private requestId = 1;
  private readonly pending = new Map<number, (value: any) => void>();
  private activePointer: number | null = null;
  private disposed = false;

  constructor(private readonly options: EngineHostOptions) {
    if (!styleInstalled) {
      styleInstalled = true;
      const style = document.createElement('style');
      style.textContent = OVERLAY_CSS;
      document.head.appendChild(style);
    }
    const { container } = options;
    container.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mimicry-canvas';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;touch-action:none;display:block;';
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'mimicry-overlays';
    this.overlayRoot.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;';
    container.append(this.canvas, this.overlayRoot);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.compositor = new Compositor({
      canvases: { create: (w, h) => new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) as any },
      images: { get: (uri) => this.images.get(uri) ?? null },
    });
    this.overlays = new OverlayLayer(this.overlayRoot, {
      textChange: (nodeId, text, selection) => this.post({ type: 'textChange', nodeId, text, selection }),
      textEvent: (nodeId, event, key) => this.post({ type: 'textEvent', nodeId, event, key }),
    });
    this.installInput();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  async boot(environment: EnvironmentSpec, app: AppBundle): Promise<void> {
    this.worker?.terminate();
    this.overlays.clear();
    this.compositor.invalidate();
    const fonts = this.options.fonts;
    await loadDocumentFonts(fonts);
    if (this.disposed) return;
    this.resize(environment);
    const worker = new Worker(this.options.workerUrl, { name: 'mimicry-engine' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<EngineMessage>) => this.receive(e.data);
    worker.onerror = (e) => this.options.onMessage?.({ type: 'error', error: { kind: 'runtime', message: e.message || 'Engine worker failed to start' } });
    this.post({ type: 'boot', environment, app, fonts, fontMode: this.options.fontMode ?? 'system', clock: 'host' });
  }

  setEnvironment(environment: Partial<EnvironmentSpec>, full: EnvironmentSpec): void {
    this.resize(full);
    this.post({ type: 'environment', environment });
  }

  hotUpdate(modules: ModuleRecord[]): void {
    this.post({ type: 'hmr', modules, removed: [] });
  }

  reload(app?: AppBundle): void {
    this.post({ type: 'reload', app });
  }

  back(): void {
    this.post({ type: 'back' });
  }

  setAnimationScale(factor: number): void {
    this.post({ type: 'animationScale', factor });
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (this.viewport) this.applySize(this.viewport);
  }

  inspect(): Promise<InspectorNode | null> {
    return this.request((requestId) => ({ type: 'inspect', requestId }), 'tree');
  }

  hitTest(x: number, y: number): Promise<{ nodeId: number | null; path: number[] }> {
    return this.request((requestId) => ({ type: 'hitTest', requestId, x, y }), null);
  }

  destroy(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.canvas.remove();
    this.overlayRoot.remove();
  }

  /** current frame as a PNG data URL (device resolution) */
  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  get logicalSize(): { width: number; height: number } | null {
    return this.viewport ? { width: this.viewport.width, height: this.viewport.height } : null;
  }

  // ── internals ─────────────────────────────────────────────────────────

  private request<T>(make: (id: number) => HostMessage, field: string | null): Promise<T> {
    const id = this.requestId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, (msg) => resolve(field ? msg[field] : msg));
      this.post(make(id));
    });
  }

  private post(message: HostMessage): void {
    this.worker?.postMessage(message);
  }

  private resize(env: EnvironmentSpec): void {
    this.viewport = resolveViewport(env.device, env.orientation, env.fontScale);
    this.applySize(this.viewport);
  }

  private applySize(v: Viewport): void {
    const pw = Math.round(v.width * v.scale);
    const ph = Math.round(v.height * v.scale);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.canvas.style.width = `${v.width * this.zoom}px`;
    this.canvas.style.height = `${v.height * this.zoom}px`;
    this.overlayRoot.style.width = `${v.width}px`;
    this.overlayRoot.style.height = `${v.height}px`;
    this.overlayRoot.style.transform = `scale(${this.zoom})`;
  }

  private receive(message: EngineMessage): void {
    switch (message.type) {
      case 'requestFrame':
        if (!this.frameScheduled) {
          this.frameScheduled = true;
          requestAnimationFrame((time) => {
            this.frameScheduled = false;
            this.post({ type: 'frame', time });
          });
        }
        return;
      case 'frame': {
        const frame = decodeFrame(message.buffer);
        const v = this.viewport;
        if (!v) return;
        const host = this.compositor.paint(this.ctx, frame, v.scale, this.canvas.width, this.canvas.height);
        this.overlays.update(frame.overlays);
        this.options.onFrame?.({ engine: message.stats, host });
        return;
      }
      case 'loadImage':
        this.loadImage(message.uri);
        return;
      case 'focusInput':
        this.overlays.focus(message.nodeId);
        return;
      case 'blurInput':
        this.overlays.blur(message.nodeId);
        return;
      case 'openURL':
        window.open(message.url, '_blank', 'noopener,noreferrer');
        break;
      case 'inspectResult':
      case 'hitTestResult':
      case 'queryResult': {
        const resolve = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        resolve?.(message);
        return;
      }
    }
    this.options.onMessage?.(message);
  }

  private loadImage(uri: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = uri;
    img
      .decode()
      .then(() => {
        this.images.set(uri, img);
        this.post({ type: 'imageLoaded', uri, width: img.naturalWidth, height: img.naturalHeight });
      })
      .catch(() => this.post({ type: 'imageFailed', uri, error: `Failed to load ${uri}` }));
  }

  /** client coordinates → logical device points */
  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.viewport!;
    return { x: ((clientX - rect.left) / rect.width) * v.width, y: ((clientY - rect.top) / rect.height) * v.height };
  }

  private installInput(): void {
    const c = this.canvas;
    const send = (phase: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent) => {
      const p = this.toLogical(e.clientX, e.clientY);
      this.post({ type: 'pointer', phase, id: e.pointerId, x: p.x, y: p.y, time: performance.now() });
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.activePointer !== null || e.button > 0) return;
      // tapping the canvas leaves any focused native input, like tapping outside on device
      if (document.activeElement instanceof HTMLElement && this.overlayRoot.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      this.activePointer = e.pointerId;
      c.setPointerCapture(e.pointerId);
      send('down', e);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.activePointer) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) send('move', ev);
    });
    c.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      send('up', e);
    });
    c.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== this.activePointer) return;
      this.activePointer = null;
      send('cancel', e);
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.toLogical(e.clientX, e.clientY);
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.post({ type: 'wheel', x: p.x, y: p.y, dx: (e.deltaX * k) / this.zoom, dy: (e.deltaY * k) / this.zoom, time: performance.now() });
      },
      { passive: false },
    );
    // Overlay inputs sit above the canvas; let them take pointer events.
    this.overlayRoot.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
}
