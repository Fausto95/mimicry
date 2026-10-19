/**
 * android.content.SharedPreferences: a named key-value file. Values keep
 * their type (string, int/long/float as number, boolean, string set).
 */
export type PreferenceValue = string | number | boolean | ReadonlySet<string>;

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
  registerOnSharedPreferenceChangeListener(listener: (prefs: SharedPreferences, key: string | null) => void): void;
  unregisterOnSharedPreferenceChangeListener(listener: (prefs: SharedPreferences, key: string | null) => void): void;
}

/** Backing store: where committed values go (the kernel's persistent storage). */
export interface PreferenceStore {
  load(name: string): Map<string, PreferenceValue>;
  save(name: string, values: ReadonlyMap<string, PreferenceValue>): void;
}

export class SharedPreferencesImpl implements SharedPreferences {
  private readonly values: Map<string, PreferenceValue>;
  private readonly listeners = new Set<(prefs: SharedPreferences, key: string | null) => void>();

  constructor(private readonly name: string, private readonly store: PreferenceStore) {
    this.values = store.load(name);
  }

  getAll(): ReadonlyMap<string, PreferenceValue> {
    return new Map(this.values);
  }

  private get<T>(key: string, type: string, def: T): T {
    const v = this.values.get(key);
    if (v === undefined) return def;
    if (type === 'set' ? !(v instanceof Set) : typeof v !== type) {
      throw new Error(`ClassCastException: ${key} is not a ${type}`);
    }
    return v as T;
  }

  getString(key: string, defValue: string | null): string | null {
    return this.get(key, 'string', defValue);
  }

  getInt(key: string, defValue: number): number {
    return this.get(key, 'number', defValue);
  }

  getLong(key: string, defValue: number): number {
    return this.get(key, 'number', defValue);
  }

  getFloat(key: string, defValue: number): number {
    return this.get(key, 'number', defValue);
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
    const changes = new Map<string, PreferenceValue | null>();
    let clear = false;
    const editor: SharedPreferencesEditor = {
      putString: (k, v) => (changes.set(k, v), editor),
      putInt: (k, v) => (changes.set(k, Math.trunc(v)), editor),
      putLong: (k, v) => (changes.set(k, Math.trunc(v)), editor),
      putFloat: (k, v) => (changes.set(k, v), editor),
      putBoolean: (k, v) => (changes.set(k, v), editor),
      putStringSet: (k, v) => (changes.set(k, v ? new Set(v) : null), editor),
      remove: (k) => (changes.set(k, null), editor),
      clear: () => ((clear = true), editor),
      commit: () => {
        if (clear) this.values.clear();
        for (const [k, v] of changes) {
          if (v === null) this.values.delete(k);
          else this.values.set(k, v);
        }
        this.store.save(this.name, this.values);
        for (const listener of Array.from(this.listeners)) {
          if (clear) listener(this, null);
          for (const k of changes.keys()) listener(this, k);
        }
        return true;
      },
      apply: () => {
        editor.commit();
      },
    };
    return editor;
  }

  registerOnSharedPreferenceChangeListener(listener: (prefs: SharedPreferences, key: string | null) => void): void {
    this.listeners.add(listener);
  }

  unregisterOnSharedPreferenceChangeListener(listener: (prefs: SharedPreferences, key: string | null) => void): void {
    this.listeners.delete(listener);
  }
}
