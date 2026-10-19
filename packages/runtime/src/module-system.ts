import type { ModuleRecord } from '@mimicry/protocol';
import { isRefreshBoundary, performRefresh, refreshHelpers } from './refresh';

/**
 * The linker. Side-module records carry a dependency map, so binding an
 * import is a table lookup: `require('./Button')` → record id → instance, and
 * `require('react-native')` → the base module's export. Hot updates
 * re-execute changed modules up to the nearest React Refresh boundary.
 */
export interface ModuleScope {
  setTimeout: (fn: () => void, ms?: number) => unknown;
  clearTimeout: (h: unknown) => void;
  setInterval: (fn: () => void, ms?: number) => unknown;
  clearInterval: (h: unknown) => void;
  requestAnimationFrame: (cb: (t: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  process: { env: Record<string, string | undefined> };
}

interface Instance {
  exports: any;
  loaded: boolean;
}

type Factory = (
  require: (specifier: string) => unknown,
  module: { exports: any; id: string },
  exports: any,
  __filename: string,
  __dirname: string,
  process: ModuleScope['process'],
  setTimeout: ModuleScope['setTimeout'],
  clearTimeout: ModuleScope['clearTimeout'],
  setInterval: ModuleScope['setInterval'],
  clearInterval: ModuleScope['clearInterval'],
  requestAnimationFrame: ModuleScope['requestAnimationFrame'],
  cancelAnimationFrame: ModuleScope['cancelAnimationFrame'],
  $RefreshReg$: (type: unknown, id: string) => void,
  $RefreshSig$: () => unknown,
  global: typeof globalThis,
) => void;

export class ModuleError extends Error {
  constructor(message: string, readonly moduleId?: string) {
    super(message);
    this.name = 'ModuleError';
  }
}

export class ModuleSystem {
  private readonly records = new Map<string, ModuleRecord>();
  private readonly factories = new Map<string, Factory>();
  private instances = new Map<string, Instance>();
  /** modules whose last evaluation threw; a fix must re-run them */
  private readonly failed = new Set<string>();

  /**
   * @param provided resolves a provided specifier (`react-native`, or a deep
   *   `react-native/Libraries/…` path) to its module, or returns undefined.
   */
  constructor(
    private readonly provided: (specifier: string) => unknown,
    private readonly scope: ModuleScope,
  ) {}

  load(records: ModuleRecord[]): void {
    for (const r of records) {
      this.records.set(r.id, r);
      this.factories.delete(r.id);
    }
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  private factory(id: string): Factory {
    let f = this.factories.get(id);
    if (!f) {
      const record = this.records.get(id);
      if (!record) throw new ModuleError(`Module "${id}" is not in the bundle.`, id);
      try {
        // eslint-disable-next-line no-new-func
        f = new Function(
          'require', 'module', 'exports', '__filename', '__dirname', 'process',
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
          '$RefreshReg$', '$RefreshSig$', 'global',
          `${record.code}\n//# sourceURL=mimicry:///${id}`,
        ) as Factory;
      } catch (error) {
        throw new ModuleError(`SyntaxError in ${id}: ${(error as Error).message}`, id);
      }
      this.factories.set(id, f);
    }
    return f;
  }

  require(id: string): unknown {
    if (id.startsWith('provided:')) return this.providedModule(id.slice('provided:'.length));
    const existing = this.instances.get(id);
    if (existing) return existing.exports;
    const record = this.records.get(id);
    if (!record) throw new ModuleError(`Unable to resolve module "${id}".`, id);
    const module = { exports: {} as any, id };
    const instance: Instance = { exports: module.exports, loaded: false };
    this.instances.set(id, instance);
    const localRequire = (specifier: string) => {
      const target = record.deps[specifier];
      if (target === undefined) {
        const provided = this.provided(specifier);
        if (provided !== undefined) return provided;
        throw new ModuleError(`Unable to resolve "${specifier}" from "${id}".`, id);
      }
      if (target.startsWith('error:')) throw new ModuleError(target.slice('error:'.length), id);
      return this.require(target);
    };
    const refresh = refreshHelpers(id);
    const dir = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';
    try {
      this.factory(id)(
        localRequire, module, module.exports, id, dir, this.scope.process,
        this.scope.setTimeout, this.scope.clearTimeout, this.scope.setInterval, this.scope.clearInterval,
        this.scope.requestAnimationFrame, this.scope.cancelAnimationFrame,
        refresh.register, refresh.signature, globalThis,
      );
    } catch (error) {
      this.instances.delete(id);
      this.failed.add(id);
      throw error;
    }
    this.failed.delete(id);
    instance.exports = module.exports;
    instance.loaded = true;
    return instance.exports;
  }

  private providedModule(specifier: string): unknown {
    const module = this.provided(specifier);
    if (module === undefined) throw new ModuleError(`The base module does not provide "${specifier}".`);
    return module;
  }

  /** Forget every instance (a full reload re-executes the entry). */
  reset(): void {
    this.instances = new Map();
    this.failed.clear();
  }

  private importers(): Map<string, Set<string>> {
    const inverse = new Map<string, Set<string>>();
    for (const record of this.records.values()) {
      for (const target of Object.values(record.deps)) {
        let set = inverse.get(target);
        if (!set) inverse.set(target, (set = new Set()));
        set.add(record.id);
      }
    }
    return inverse;
  }

  /**
   * Apply a hot update. Returns 'refreshed' when React Refresh handled it,
   * or 'reload' when the change reached the entry without a boundary.
   */
  hotUpdate(records: ModuleRecord[], entry: string): 'refreshed' | 'reload' {
    const previous = new Map<string, unknown>();
    for (const r of records) previous.set(r.id, this.instances.get(r.id)?.exports);
    this.load(records);
    const importers = this.importers();

    // Walk up from each changed module until every path ends at a boundary.
    const toRerun = new Set<string>();
    const queue = records.map((r) => r.id).filter((id) => this.instances.has(id) || previous.get(id) !== undefined || this.failed.has(id));
    if (!queue.length) return 'refreshed'; // nothing loaded depends on it yet
    while (queue.length) {
      const id = queue.shift()!;
      if (toRerun.has(id)) continue;
      toRerun.add(id);
      const exports = this.instances.get(id)?.exports ?? previous.get(id);
      if (id !== entry && isRefreshBoundary(exports)) continue;
      if (id === entry) return 'reload';
      const parents = importers.get(id);
      if (!parents?.size) return 'reload';
      for (const p of parents) if (this.instances.has(p)) queue.push(p);
    }
    for (const id of toRerun) this.instances.delete(id);
    // Re-execute boundaries (and the modules between them and the change).
    for (const id of toRerun) {
      if (!this.instances.has(id)) {
        try {
          this.require(id);
        } catch (error) {
          // Everything invalidated by this update is stale until a fix re-runs it.
          for (const other of toRerun) if (!this.instances.has(other)) this.failed.add(other);
          throw error;
        }
      }
      const exports = this.instances.get(id)?.exports;
      if (id !== entry && !isRefreshBoundary(exports) && ![...(importers.get(id) ?? [])].some((p) => toRerun.has(p))) {
        return 'reload';
      }
    }
    performRefresh();
    return 'refreshed';
  }
}
