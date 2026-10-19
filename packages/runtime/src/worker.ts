/**
 * The base module's entry point in the browser: a Web Worker that owns the
 * engine, React and the app. The page (host) only paints frames and forwards
 * input — the same split as Dactyl's Wasm engine and its JS host.
 */
import { installRefresh } from './refresh';
installRefresh();

import { CanvasTextMeasurer, Engine, RealClock, loadYoga } from '@mimicry/engine';
import type { EngineMessage, HostMessage } from '@mimicry/protocol';
import { CAPABILITIES } from '@mimicry/react-native';
import { AppRuntime } from './app-runtime';

declare const self: {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<HostMessage>) => void) | null;
  fonts?: { add(face: unknown): void };
};

(globalThis as any).__DEV__ = true;

let engine: Engine | null = null;
let runtime: AppRuntime | null = null;
const queued: HostMessage[] = [];
let booting = false;

const send = (message: EngineMessage, transfer?: Transferable[]) => self.postMessage(message, transfer);

// Forward console output to the host's log panel as well.
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    try {
      send({ type: 'log', level, message: args.map(format).join(' ') });
    } catch {
      // unserializable; already printed to the worker console
    }
  };
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function boot(message: Extract<HostMessage, { type: 'boot' }>): Promise<void> {
  const FontFaceCtor = (globalThis as any).FontFace;
  if (FontFaceCtor && self.fonts && message.fonts?.length) {
    await Promise.all(
      message.fonts.map(async (f) => {
        try {
          const face = new FontFaceCtor(f.family, `url(${f.url})`, { weight: f.weight, style: f.style });
          self.fonts!.add(face);
          await face.load();
        } catch (error) {
          console.warn(`[mimicry] font ${f.family} ${f.weight} failed to load`, error);
        }
      }),
    );
  }
  const yoga = await loadYoga();
  const canvas = new OffscreenCanvas(8, 8);
  engine = new Engine({
    yoga,
    measurer: new CanvasTextMeasurer(canvas.getContext('2d') as any),
    clock: new RealClock(),
    environment: message.environment,
    send,
    bundledFonts: message.fontMode === 'bundled',
    hostInputs: true,
  });
  runtime = new AppRuntime(engine, {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as number),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as number),
  });
  runtime.start(message.app);
  send({ type: 'ready', capabilities: CAPABILITIES, platform: engine.platform });
  engine.requestFrame();
}

function dispatch(message: HostMessage): void {
  if (!engine || !runtime) {
    queued.push(message);
    return;
  }
  switch (message.type) {
    case 'hmr':
      runtime.hotUpdate(message.modules);
      break;
    case 'reload':
      runtime.reload(message.app ?? undefined);
      break;
    default:
      engine.handle(message);
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'boot') {
    if (booting) return;
    booting = true;
    boot(message)
      .then(() => {
        for (const m of queued.splice(0)) dispatch(m);
      })
      .catch((error) => send({ type: 'error', error: { kind: 'runtime', message: String(error?.message ?? error), stack: error?.stack } }));
    return;
  }
  dispatch(message);
};
