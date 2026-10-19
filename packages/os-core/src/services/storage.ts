/**
 * The device's persistent storage: namespaced string key/value files.
 * NSUserDefaults and SharedPreferences sit on it, as do frameworks' storage
 * modules (AsyncStorage, MMKV, SecureStore).
 *
 * Reads are synchronous, so the data lives in memory. In the browser the
 * host persists every write (per project) and hands the snapshot back at
 * boot, so data survives a reload the way it survives an app restart;
 * headless runs start empty, like a fresh install.
 */
export type StorageSnapshot = Record<string, Record<string, string>>;

export interface StorageHost {
  /** persist one write (null deletes) */
  persist(namespace: string, key: string, value: string | null): void;
}

export class StorageService {
  private readonly data = new Map<string, Map<string, string>>();
  private readonly listeners = new Set<(namespace: string, key: string | null) => void>();

  constructor(private readonly host: StorageHost) {}

  /** Replace everything with a snapshot from an earlier run. */
  load(snapshot: StorageSnapshot | undefined): void {
    this.data.clear();
    for (const [namespace, entries] of Object.entries(snapshot ?? {})) this.data.set(namespace, new Map(Object.entries(entries)));
  }

  snapshot(): StorageSnapshot {
    const out: StorageSnapshot = {};
    for (const [ns, entries] of this.data) out[ns] = Object.fromEntries(entries);
    return out;
  }

  private space(namespace: string): Map<string, string> {
    let m = this.data.get(namespace);
    if (!m) this.data.set(namespace, (m = new Map()));
    return m;
  }

  get(namespace: string, key: string): string | undefined {
    return this.data.get(namespace)?.get(key);
  }

  set(namespace: string, key: string, value: string): void {
    this.space(namespace).set(key, value);
    this.host.persist(namespace, key, value);
    this.notify(namespace, key);
  }

  delete(namespace: string, key: string): void {
    if (!this.data.get(namespace)?.delete(key)) return;
    this.host.persist(namespace, key, null);
    this.notify(namespace, key);
  }

  keys(namespace: string): string[] {
    return Array.from(this.data.get(namespace)?.keys() ?? []);
  }

  clear(namespace: string): void {
    for (const key of this.keys(namespace)) this.delete(namespace, key);
    this.notify(namespace, null);
  }

  namespaces(): string[] {
    return Array.from(this.data.keys());
  }

  /** Observe writes (NSUserDefaults didChangeNotification, OnSharedPreferenceChangeListener). */
  subscribe(listener: (namespace: string, key: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(namespace: string, key: string | null): void {
    for (const listener of Array.from(this.listeners)) listener(namespace, key);
  }
}
