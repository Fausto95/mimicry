import type { Kernel } from '@mimicry/os-core';

/**
 * android.content.SharedPreferences: a named key-value file. Values keep
 * their exact type (String, int, long, float, boolean, Set<String>): reading
 * a key as another type throws ClassCastException, as on Android.
 *
 * Preferences live in the kernel's persistent storage, one namespace per
 * file (`shared_prefs:<name>`), each value stored with its type tag
 * (`{"type":"int","value":3}`), so they survive a reload in the browser like
 * the XML file survives an app restart. Changes apply to memory at once;
 * commit() and apply() both write through.
 */
export type PreferenceValue = string | number | boolean | ReadonlySet<string>;
export type PreferenceType = 'string' | 'int' | 'long' | 'float' | 'boolean' | 'set';

export interface TypedPreference {
  type: PreferenceType;
  value: PreferenceValue;
}

export interface SharedPreferencesEditor {
  putString(key: string, value: string | null): SharedPreferencesEditor;
  putInt(key: string, value: number): SharedPreferencesEditor;
  putLong(key: string, value: number): SharedPreferencesEditor;
  putFloat(key: string, value: number): SharedPreferencesEditor;
  putBoolean(key: string, value: boolean): SharedPreferencesEditor;
  putStringSet(key: string, values: ReadonlySet<string> | null): SharedPreferencesEditor;
  remove(key: string): SharedPreferencesEditor;
  clear(): SharedPreferencesEditor;
  commit(): boolean;
  apply(): void;
}

export type OnSharedPreferenceChangeListener = (prefs: SharedPreferences, key: string | null) => void;

export interface SharedPreferences {
  getAll(): ReadonlyMap<string, PreferenceValue>;
  getString(key: string, defValue: string | null): string | null;
  getInt(key: string, defValue: number): number;
  getLong(key: string, defValue: number): number;
  getFloat(key: string, defValue: number): number;
  getBoolean(key: string, defValue: boolean): boolean;
  getStringSet(key: string, defValues: ReadonlySet<string> | null): ReadonlySet<string> | null;
  contains(key: string): boolean;
  edit(): SharedPreferencesEditor;
  registerOnSharedPreferenceChangeListener(listener: OnSharedPreferenceChangeListener): void;
  unregisterOnSharedPreferenceChangeListener(listener: OnSharedPreferenceChangeListener): void;
}

/** Backing store: where committed values go. */
export interface PreferenceStore {
  load(name: string): Map<string, TypedPreference>;
  /** write the keys that changed (null removes) */
  save(name: string, changes: ReadonlyMap<string, TypedPreference | null>): void;
}

const JAVA_TYPE: Record<PreferenceType, string> = {
  string: 'java.lang.String', int: 'java.lang.Integer', long: 'java.lang.Long', float: 'java.lang.Float', boolean: 'java.lang.Boolean', set: 'java.util.HashSet',
};

export class SharedPreferencesImpl implements SharedPreferences {
  private readonly values: Map<string, TypedPreference>;
  private readonly listeners = new Set<OnSharedPreferenceChangeListener>();

  constructor(private readonly name: string, private readonly store: PreferenceStore) {
    this.values = store.load(name);
  }

  getAll(): ReadonlyMap<string, PreferenceValue> {
    return new Map(Array.from(this.values, ([k, v]) => [k, v.type === 'set' ? new Set(v.value as ReadonlySet<string>) : v.value]));
  }

  private get<T>(key: string, type: PreferenceType, def: T): T {
    const v = this.values.get(key);
    if (v === undefined) return def;
    if (v.type !== type) throw new Error(`ClassCastException: ${JAVA_TYPE[v.type]} cannot be cast to ${JAVA_TYPE[type]}`);
    return (type === 'set' ? new Set(v.value as ReadonlySet<string>) : v.value) as T;
  }

  getString(key: string, defValue: string | null): string | null {
    return this.get(key, 'string', defValue);
  }

  getInt(key: string, defValue: number): number {
    return this.get(key, 'int', defValue);
  }

  getLong(key: string, defValue: number): number {
    return this.get(key, 'long', defValue);
  }

  getFloat(key: string, defValue: number): number {
    return this.get(key, 'float', defValue);
  }

  getBoolean(key: string, defValue: boolean): boolean {
    return this.get(key, 'boolean', defValue);
  }

  getStringSet(key: string, defValues: ReadonlySet<string> | null): ReadonlySet<string> | null {
    return this.get(key, 'set', defValues);
  }

  contains(key: string): boolean {
    return this.values.has(key);
  }

  edit(): SharedPreferencesEditor {
    const changes = new Map<string, TypedPreference | null>();
    let clear = false;
    const put = (key: string, type: PreferenceType, value: PreferenceValue | null) => {
      changes.set(key, value === null ? null : { type, value });
      return editor;
    };
    const int32 = (v: number) => Math.trunc(v) | 0;
    const editor: SharedPreferencesEditor = {
      putString: (k, v) => put(k, 'string', v),
      putInt: (k, v) => put(k, 'int', int32(v)),
      putLong: (k, v) => put(k, 'long', Math.trunc(v)),
      putFloat: (k, v) => put(k, 'float', Math.fround(v)),
      putBoolean: (k, v) => put(k, 'boolean', v),
      putStringSet: (k, v) => put(k, 'set', v ? new Set(v) : null),
      remove: (k) => put(k, 'string', null),
      clear: () => {
        clear = true;
        return editor;
      },
      commit: () => {
        const written = new Map<string, TypedPreference | null>();
        if (clear) {
          for (const k of this.values.keys()) written.set(k, null);
          this.values.clear();
        }
        const changed: string[] = [];
        for (const [k, v] of changes) {
          const before = this.values.get(k);
          if (v === null) {
            if (before === undefined) continue;
            this.values.delete(k);
          } else {
            if (before && before.type === v.type && sameValue(before.value, v.value)) continue;
            this.values.set(k, v);
          }
          written.set(k, v);
          changed.push(k);
        }
        changes.clear();
        if (written.size) this.store.save(this.name, written);
        for (const listener of Array.from(this.listeners)) {
          if (clear) listener(this, null);
          for (const k of changed) listener(this, k);
        }
        clear = false;
        return true;
      },
      apply: () => {
        editor.commit();
      },
    };
    return editor;
  }

  registerOnSharedPreferenceChangeListener(listener: OnSharedPreferenceChangeListener): void {
    this.listeners.add(listener);
  }

  unregisterOnSharedPreferenceChangeListener(listener: OnSharedPreferenceChangeListener): void {
    this.listeners.delete(listener);
  }
}

function sameValue(a: PreferenceValue, b: PreferenceValue): boolean {
  if (a instanceof Set && b instanceof Set) return a.size === b.size && Array.from(a).every((x) => b.has(x));
  return a === b;
}

/** SharedPreferences files in the kernel's persistent storage. */
export class KernelPreferenceStore implements PreferenceStore {
  constructor(private readonly kernel: Kernel) {}

  static namespace(name: string): string {
    return `shared_prefs:${name}`;
  }

  load(name: string): Map<string, TypedPreference> {
    const ns = KernelPreferenceStore.namespace(name);
    const out = new Map<string, TypedPreference>();
    for (const key of this.kernel.storage.keys(ns)) {
      const raw = this.kernel.storage.get(ns, key);
      const parsed = raw === undefined ? null : decode(raw);
      if (parsed) out.set(key, parsed);
      else this.kernel.warnOnce(`prefs:${ns}:${key}`, `SharedPreferences ${name}: ignoring the unreadable value of "${key}"`);
    }
    return out;
  }

  save(name: string, changes: ReadonlyMap<string, TypedPreference | null>): void {
    const ns = KernelPreferenceStore.namespace(name);
    for (const [key, value] of changes) {
      if (value === null) this.kernel.storage.delete(ns, key);
      else this.kernel.storage.set(ns, key, encode(value));
    }
  }
}

function encode(p: TypedPreference): string {
  const value = p.type === 'set' ? Array.from(p.value as ReadonlySet<string>) : p.value;
  return JSON.stringify({ type: p.type, value });
}

const TYPES = new Set<PreferenceType>(['string', 'int', 'long', 'float', 'boolean', 'set']);

function decode(raw: string): TypedPreference | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; value?: unknown };
    const type = parsed.type as PreferenceType;
    if (!TYPES.has(type)) return null;
    const v = parsed.value;
    switch (type) {
      case 'string': return typeof v === 'string' ? { type, value: v } : null;
      case 'boolean': return typeof v === 'boolean' ? { type, value: v } : null;
      case 'set': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? { type, value: new Set(v as string[]) } : null;
      default: return typeof v === 'number' ? { type, value: v } : null;
    }
  } catch {
    return null;
  }
}

/** androidx.preference.PreferenceManager */
export const PreferenceManager = {
  getDefaultSharedPreferencesName(context: { getPackageName(): string }): string {
    return `${context.getPackageName()}_preferences`;
  },
  getDefaultSharedPreferences(context: { getPackageName(): string; getSharedPreferences(name: string, mode?: number): SharedPreferences }): SharedPreferences {
    return context.getSharedPreferences(PreferenceManager.getDefaultSharedPreferencesName(context), 0);
  },
};
