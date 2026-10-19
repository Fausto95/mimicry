import { scheduleOnJS, uiRuntime } from '../reanimated/runtime';

/**
 * react-native-worklets. Mimicry has a single JavaScript thread: "worklets"
 * are ordinary functions, the UI runtime is the engine frame loop
 * (reanimated/runtime.ts) and the RN runtime is the engine clock's next
 * macrotask. Scheduling semantics are kept — `runOnUI` runs on the next UI
 * frame, `runOnJS` / `scheduleOnRN` asynchronously — so code that relies on
 * ordering behaves as on device.
 */
type AnyFn = (...args: any[]) => any;

export const RuntimeKind = { ReactNative: 1, UI: 2, Worker: 3 } as const;
export const UIRuntimeId = 1;

export interface WorkletRuntime {
  readonly name: string;
  readonly __mimicryRuntime: true;
}

/** Functions with a 'worklet' directive (kept by Mimicry's compiler) or a plugin hash. */
export function isWorkletFunction(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  if ('__workletHash' in value) return true;
  const source = Function.prototype.toString.call(value);
  return /^[^{]*\{\s*(['"])worklet\1/.test(source);
}

export function runOnJS<F extends AnyFn>(fn: F): (...args: Parameters<F>) => void {
  return (...args) => scheduleOnJS(() => fn(...args));
}

export function scheduleOnRN<F extends AnyFn>(fn: F, ...args: Parameters<F>): void {
  scheduleOnJS(() => fn(...args));
}

export function runOnUI<F extends AnyFn>(fn: F): (...args: Parameters<F>) => void {
  return (...args) => uiRuntime().enqueue(() => fn(...args));
}

export function scheduleOnUI<F extends AnyFn>(fn: F, ...args: Parameters<F>): void {
  uiRuntime().enqueue(() => fn(...args));
}

export function runOnUISync<F extends AnyFn>(fn: F, ...args: Parameters<F>): ReturnType<F> {
  return fn(...args);
}

export function executeOnUIRuntimeSync<F extends AnyFn>(fn: F): (...args: Parameters<F>) => ReturnType<F> {
  return (...args) => fn(...args);
}

export function runOnUIAsync<F extends AnyFn>(fn: F, ...args: Parameters<F>): Promise<ReturnType<F>> {
  return new Promise((resolve, reject) =>
    uiRuntime().enqueue(() => {
      try {
        resolve(fn(...args));
      } catch (error) {
        reject(error);
      }
    }),
  );
}

let runtimes = 0;
export function createWorkletRuntime(nameOrConfig?: string | { name?: string }): WorkletRuntime {
  const name = typeof nameOrConfig === 'string' ? nameOrConfig : nameOrConfig?.name ?? `runtime-${++runtimes}`;
  return { name, __mimicryRuntime: true };
}

export function runOnRuntime<F extends AnyFn>(_runtime: WorkletRuntime, fn: F): (...args: Parameters<F>) => void {
  return (...args) => queueMicrotask(() => fn(...args));
}
export function scheduleOnRuntime<F extends AnyFn>(_runtime: WorkletRuntime, fn: F, ...args: Parameters<F>): void {
  queueMicrotask(() => fn(...args));
}
export const scheduleOnRuntimeWithId = (_id: number, fn: AnyFn, ...args: unknown[]) => queueMicrotask(() => fn(...args));
export function runOnRuntimeSync<F extends AnyFn>(_runtime: WorkletRuntime, fn: F, ...args: Parameters<F>): ReturnType<F> {
  return fn(...args);
}
export const runOnRuntimeSyncWithId = (_id: number, fn: AnyFn, ...args: unknown[]) => fn(...args);
export function runOnRuntimeAsync<F extends AnyFn>(_runtime: WorkletRuntime, fn: F, ...args: Parameters<F>): Promise<ReturnType<F>> {
  return Promise.resolve().then(() => fn(...args));
}
export const runOnRuntimeAsyncWithId = (_id: number, fn: AnyFn, ...args: unknown[]) => Promise.resolve().then(() => fn(...args));

export const getUIRuntimeHolder = () => ({ name: 'UI', __mimicryRuntime: true });
export const getUISchedulerHolder = () => ({});
export const getRuntimeKind = () => RuntimeKind.ReactNative;
export const isRNRuntime = () => true;
export const isUIRuntime = () => false;
export const isWorkerRuntime = () => false;
export const isWorkletRuntime = () => false;
export const getCurrentThreadId = () => 0;

// ── memory model: one heap, so sharing is identity ─────────────────────────

export const makeShareable = <T>(value: T): T => value;
export const makeShareableCloneRecursive = <T>(value: T): T => value;
export const makeShareableCloneOnUIRecursive = <T>(value: T): T => value;
export const createSerializable = <T>(value: T): T => value;
export const createShareable = <T>(value: T): T => value;
export const isShareableRef = (_value: unknown) => false;
export const isSerializableRef = (_value: unknown) => false;
export const isShareable = (_value: unknown) => false;
export const isSynchronizable = (value: unknown) => !!value && typeof value === 'object' && '__synchronizable' in value;
export const registerCustomSerializable = (_registration: unknown) => {};
export const callMicrotasks = () => {};
const noopCache = { get: () => undefined, set: () => {} };
export const shareableMappingCache = noopCache;
export const serializableMappingCache = noopCache;

export function createSynchronizable<T>(initial: T) {
  let value = initial;
  return {
    __synchronizable: true as const,
    getBlocking: () => value,
    getDirty: () => value,
    setBlocking: (next: T | ((previous: T) => T)) => {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
    },
    lock() {},
    unlock() {},
  };
}

// ── flags & debug ──────────────────────────────────────────────────────────

const flags = new Map<string, unknown>();
export const getStaticFeatureFlag = (name: string) => flags.get(name) ?? false;
export const getDynamicFeatureFlag = (name: string) => flags.get(name) ?? false;
export const setDynamicFeatureFlag = (name: string, value: unknown) => void flags.set(name, value);
export const isBundleModeEnabled = () => false;
export const toggleSlowAnimationsOnUIRuntime = () => {};

/** The native module object; nothing in Mimicry needs to call into it. */
export const WorkletsModule = {
  makeShareableClone: <T>(value: T) => value,
  scheduleOnUI: (fn: () => void) => uiRuntime().enqueue(fn),
  createWorkletRuntime: (name: string) => createWorkletRuntime(name),
};
