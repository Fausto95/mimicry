import type { CapabilityLevel, PlatformName } from '@mimicry/protocol';
import type { OperatingSystem } from './os';

/**
 * A framework adapter: everything a UI framework needs to run on a
 * simulated device. On a real phone a framework is two halves — JavaScript
 * that runs in an engine (Hermes, PrimJS, V8…) and a native side written
 * against the OS (UIKit, the Android View system). An adapter is the second
 * half re-written against Mimicry's OS models, plus the runtime that loads
 * and runs the first half unmodified.
 *
 *   React Native  → Fabric (shadow tree + Yoga + mounting into UIView /
 *                   android.view.View), TurboModules, the responder system
 *   Lynx          → the Element PAPI (__CreateView, __AppendElement,
 *                   __FlushElementTree…) mounting LynxUI views, Starlight layout
 *   NativeScript  → the OS classes themselves exposed under their native
 *                   names (UIView.alloc().initWithFrame, new android.widget.TextView)
 *   Vector        → __vectorHostCommit's mutation batches applied by
 *                   per-platform renderers, events as (handle, event, payload)
 *
 * Adapters only use the OS's public API (and the kernel's services);
 * nothing in os-core / os-ios / os-android knows about any framework.
 */
export interface FrameworkAdapter<Bundle = unknown, Update = unknown> {
  /** stable id ('react-native', 'lynx', 'nativescript', 'vector') */
  readonly id: string;
  readonly displayName: string;
  /** the operating systems this adapter has a native side for */
  readonly platforms: readonly PlatformName[];
  /** Start the framework's native side and runtime on a booted OS. */
  boot(os: OperatingSystem, host: AdapterHost): Promise<FrameworkInstance<Bundle, Update>>;
}

/** What the host environment lends the framework's JavaScript. */
export interface AdapterHost {
  timers: {
    setTimeout(fn: () => void, ms?: number): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(fn: () => void, ms?: number): unknown;
    clearInterval(handle: unknown): void;
  };
  /** run framework work inside the host's batching (tests wrap React's act()) */
  wrap?: (fn: () => void) => void;
}

/** A running framework on one device. */
export interface FrameworkInstance<Bundle = unknown, Update = unknown> {
  /** load and run an app bundle */
  start(bundle: Bundle): void;
  /** restart the app (with a new bundle, or the current one) */
  reload(bundle?: Bundle): void;
  /** apply a hot update; 'reload' when the framework had to restart */
  hotUpdate(update: Update): 'refreshed' | 'reload';
  /** what the framework supports, reported to the host's UI */
  capabilities(): Record<string, CapabilityLevel>;
  destroy(): void;
}

/** Adapters available to a host, by id. */
export class AdapterRegistry {
  private readonly adapters = new Map<string, FrameworkAdapter<any, any>>();

  register(adapter: FrameworkAdapter<any, any>): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): FrameworkAdapter<any, any> {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`No framework adapter "${id}" (have: ${Array.from(this.adapters.keys()).join(', ') || 'none'})`);
    return adapter;
  }

  list(): Array<FrameworkAdapter<any, any>> {
    return Array.from(this.adapters.values());
  }
}
