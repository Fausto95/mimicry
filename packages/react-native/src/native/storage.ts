import { maybeEngine } from '../engine-ref';
import { registerNativeModules } from './registry';

/**
 * The app's on-disk key/value storage (MMKV, AsyncStorage, SecureStore).
 *
 * Native storage APIs are synchronous, so the engine keeps the data in
 * memory. In the browser the host persists every write (per project, in
 * localStorage) and hands the snapshot back at boot, so data survives a
 * reload the way it survives an app restart; headless runs start empty, like
 * a fresh install.
 */
export type StorageSnapshot = Record<string, Record<string, string>>;

const data = new Map<string, Map<string, string>>();

export function loadStorage(snapshot: StorageSnapshot | undefined): void {
  data.clear();
  for (const [namespace, entries] of Object.entries(snapshot ?? {})) data.set(namespace, new Map(Object.entries(entries)));
}

function space(namespace: string): Map<string, string> {
  let m = data.get(namespace);
  if (!m) data.set(namespace, (m = new Map()));
  return m;
}

export const storage = {
  get: (namespace: string, key: string): string | undefined => data.get(namespace)?.get(key),
  set(namespace: string, key: string, value: string): void {
    space(namespace).set(key, value);
    maybeEngine()?.send({ type: 'storageWrite', namespace, key, value });
  },
  delete(namespace: string, key: string): void {
    if (!data.get(namespace)?.delete(key)) return;
    maybeEngine()?.send({ type: 'storageWrite', namespace, key, value: null });
  },
  keys: (namespace: string): string[] => Array.from(data.get(namespace)?.keys() ?? []),
  clear(namespace: string): void {
    for (const key of storage.keys(namespace)) storage.delete(namespace, key);
  },
};

// ── react-native-mmkv (v3, C++ TurboModule) ─────────────────────────────

/** MMKV values keep their type: b:true, n:1.5, s:text, a:<base64 bytes>. */
function encode(value: boolean | string | number | ArrayBuffer): string {
  if (typeof value === 'boolean') return `b:${value}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'string') return `s:${value}`;
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return `a:${btoa(binary)}`;
}

function mmkvInstance(id: string) {
  const ns = `mmkv:${id}`;
  const read = (key: string, tag: string) => {
    const raw = storage.get(ns, key);
    return raw !== undefined && raw.startsWith(tag + ':') ? raw.slice(2) : undefined;
  };
  return {
    set: (key: string, value: boolean | string | number | ArrayBuffer) => storage.set(ns, key, encode(value)),
    getBoolean: (key: string) => {
      const v = read(key, 'b');
      return v === undefined ? undefined : v === 'true';
    },
    getString: (key: string) => read(key, 's'),
    getNumber: (key: string) => {
      const v = read(key, 'n');
      return v === undefined ? undefined : Number(v);
    },
    getBuffer: (key: string) => {
      const v = read(key, 'a');
      if (v === undefined) return undefined;
      const binary = atob(v);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    },
    contains: (key: string) => storage.get(ns, key) !== undefined,
    delete: (key: string) => storage.delete(ns, key),
    remove: (key: string) => {
      const had = storage.get(ns, key) !== undefined;
      storage.delete(ns, key);
      return had;
    },
    getAllKeys: () => storage.keys(ns),
    clearAll: () => storage.clear(ns),
    recrypt: () => {},
    trim: () => {},
    get size() {
      return storage.keys(ns).reduce((n, k) => n + k.length + (storage.get(ns, k)?.length ?? 0), 0);
    },
    isReadOnly: false,
  };
}

// ── @react-native-async-storage/async-storage ──────────────────────────

type Callback = (error?: unknown, result?: unknown) => void;
const ASYNC = 'async-storage';

function asyncStorageModule() {
  const merge = (a: unknown, b: unknown): unknown => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return {
    multiGet: (keys: string[], cb: Callback) => cb(null, keys.map((k) => [k, storage.get(ASYNC, k) ?? null])),
    multiSet: (pairs: Array<[string, string]>, cb: Callback) => {
      for (const [k, v] of pairs) storage.set(ASYNC, k, v);
      cb(null);
    },
    multiRemove: (keys: string[], cb: Callback) => {
      for (const k of keys) storage.delete(ASYNC, k);
      cb(null);
    },
    multiMerge: (pairs: Array<[string, string]>, cb: Callback) => {
      for (const [k, v] of pairs) {
        const prev = storage.get(ASYNC, k);
        storage.set(ASYNC, k, prev === undefined ? v : JSON.stringify(merge(JSON.parse(prev), JSON.parse(v))));
      }
      cb(null);
    },
    getAllKeys: (cb: Callback) => cb(null, storage.keys(ASYNC)),
    clear: (cb: Callback) => {
      storage.clear(ASYNC);
      cb(null);
    },
  };
}

registerNativeModules({
  MmkvCxx: () => ({ initialize: () => true, createMMKV: (config: { id?: string }) => mmkvInstance(config.id ?? 'mmkv.default') }),
  MmkvPlatformContext: () => ({ getAppGroupDirectory: () => undefined, getBaseDirectory: () => '/mimicry/mmkv' }),
  RNCAsyncStorage: asyncStorageModule,
  PlatformLocalStorage: asyncStorageModule,
  ExpoSecureStore: () => ({
    getValueWithKeyAsync: async (key: string) => storage.get('secure-store', key) ?? null,
    getValueWithKeySync: (key: string) => storage.get('secure-store', key) ?? null,
    setValueWithKeyAsync: async (value: string, key: string) => storage.set('secure-store', key, value),
    setValueWithKeySync: (value: string, key: string) => storage.set('secure-store', key, value),
    deleteValueWithKeyAsync: async (key: string) => storage.delete('secure-store', key),
    canUseBiometricAuthentication: () => false,
  }),
});
