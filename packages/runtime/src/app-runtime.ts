import type { Engine } from '@mimicry/engine';
import type { AppBundle, ModuleRecord } from '@mimicry/protocol';
import { AppRegistry, clearErrors, installReactNative, resetNativeModules, runRegisteredApp, setAppConfig } from '@mimicry/react-native';
import { ModuleSystem, type ModuleScope } from './module-system';
import { resolveProvided } from './provided';
import { installRefresh } from './refresh';

/**
 * Runs a compiled app inside an engine: links the side module against the
 * base's provided modules, executes the entry, mounts the registered root
 * component, and applies hot updates.
 */
export class AppRuntime {
  private modules: ModuleSystem;
  private bundle: AppBundle | null = null;
  /** timers and frame callbacks scheduled by the current module generation */
  private owned = { timeouts: new Set<unknown>(), intervals: new Set<unknown>(), frames: new Set<number>() };

  constructor(
    private readonly engine: Engine,
    private readonly timers: Omit<ModuleScope, 'process' | 'requestAnimationFrame' | 'cancelAnimationFrame'>,
    private readonly wrap: (fn: () => void) => void = (fn) => fn(),
  ) {
    installRefresh();
    this.modules = this.createModules({});
  }

  private createModules(env: Record<string, string>): ModuleSystem {
    const animator = this.engine.animator;
    const owned = this.owned;
    const t = this.timers;
    return new ModuleSystem(resolveProvided, {
      setTimeout: (fn, ms) => {
        const handle: unknown = t.setTimeout(() => {
          owned.timeouts.delete(handle);
          fn();
        }, ms);
        owned.timeouts.add(handle);
        return handle;
      },
      clearTimeout: (h) => {
        owned.timeouts.delete(h);
        t.clearTimeout(h);
      },
      setInterval: (fn, ms) => {
        const handle = t.setInterval(fn, ms);
        owned.intervals.add(handle);
        return handle;
      },
      clearInterval: (h) => {
        owned.intervals.delete(h);
        t.clearInterval(h);
      },
      requestAnimationFrame: (cb) => {
        const id = animator.requestAnimationFrame((time) => {
          owned.frames.delete(id);
          cb(time);
        });
        owned.frames.add(id);
        this.engine.requestFrame();
        return id;
      },
      cancelAnimationFrame: (id) => {
        owned.frames.delete(id);
        animator.cancelAnimationFrame(id);
      },
      process: { env: { NODE_ENV: 'development', ...env } },
    });
  }

  start(bundle: AppBundle): void {
    this.bundle = bundle;
    this.modules = this.createModules({ EXPO_OS: bundle.platform, ...bundle.env });
    setAppConfig(bundle.config);
    resetNativeModules();
    this.wrap(() => installReactNative(this.engine));
    this.modules.load(bundle.modules);
    this.wrap(() => {
      try {
        AppRegistry.__reset();
        this.modules.require(bundle.entry);
        runRegisteredApp();
      } catch (error) {
        this.engine.reportError(error, (error as Error)?.name === 'ModuleError' ? 'module' : 'runtime');
      }
    });
  }

  hotUpdate(records: ModuleRecord[]): 'refreshed' | 'reload' {
    if (!this.bundle) return 'reload';
    for (const r of records) {
      const i = this.bundle.modules.findIndex((m) => m.id === r.id);
      if (i >= 0) this.bundle.modules[i] = r;
      else this.bundle.modules.push(r);
    }
    let result: 'refreshed' | 'reload' = 'reload';
    this.wrap(() => {
      try {
        result = this.modules.hotUpdate(records, this.bundle!.entry);
        // A successful refresh means the previous error was fixed.
        if (result === 'refreshed') clearErrors();
      } catch (error) {
        this.engine.reportError(error, 'module');
        result = 'refreshed';
      }
    });
    if (result === 'reload') this.reload();
    return result;
  }

  reload(bundle: AppBundle | null = this.bundle): void {
    if (!bundle) return;
    this.wrap(() => this.engine.render(null));
    // The old module generation must not keep running timers into the new one.
    for (const h of this.owned.timeouts) this.timers.clearTimeout(h);
    for (const h of this.owned.intervals) this.timers.clearInterval(h);
    for (const id of this.owned.frames) this.engine.animator.cancelAnimationFrame(id);
    this.owned = { timeouts: new Set(), intervals: new Set(), frames: new Set() };
    this.start(bundle);
  }
}
