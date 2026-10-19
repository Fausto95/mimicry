import type { StorageService } from '@mimicry/os-core';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { NotificationCenter } from './notification-center';

/**
 * UserDefaults on the kernel's storage, one namespace per suite
 * (`NSUserDefaults:<suite>`, `standard` for the app's own), so values
 * survive a reload in the browser like they survive a relaunch.
 *
 * Property-list types round-trip with their type: strings, numbers,
 * booleans, dates, Data (Uint8Array, stored as base64), arrays and
 * dictionaries of those. Readers convert like Foundation: integer(forKey:)
 * parses numeric strings and truncates doubles, bool(forKey:) is true for
 * non-zero numbers and "YES"/"true" strings. register(defaults:) values
 * live in memory only and lose to stored ones. Every write posts
 * didChangeNotification.
 */
export const UserDefaultsDidChangeNotification = 'NSUserDefaultsDidChangeNotification';

export type PropertyList = string | number | boolean | Date | Uint8Array | PropertyList[] | { [key: string]: PropertyList };

type Tagged =
  | { t: 's'; v: string }
  | { t: 'n'; v: number }
  | { t: 'b'; v: boolean }
  | { t: 'd'; v: number }
  | { t: 'x'; v: string }
  | { t: 'a'; v: Tagged[] }
  | { t: 'o'; v: Record<string, Tagged> };

function encode(value: PropertyList): Tagged {
  if (typeof value === 'string') return { t: 's', v: value };
  if (typeof value === 'number') return { t: 'n', v: value };
  if (typeof value === 'boolean') return { t: 'b', v: value };
  if (value instanceof Date) return { t: 'd', v: value.getTime() };
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return { t: 'x', v: btoa(binary) };
  }
  if (Array.isArray(value)) return { t: 'a', v: value.map(encode) };
  if (value && typeof value === 'object') {
    const out: Record<string, Tagged> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v);
    return { t: 'o', v: out };
  }
  throw new Error(`UserDefaults: attempt to insert non-property list object ${String(value)}`);
}

function decode(tagged: Tagged): PropertyList {
  switch (tagged.t) {
    case 's':
    case 'n':
    case 'b':
      return tagged.v;
    case 'd':
      return new Date(tagged.v);
    case 'x': {
      const binary = atob(tagged.v);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    case 'a':
      return tagged.v.map(decode);
    case 'o': {
      const out: Record<string, PropertyList> = {};
      for (const [k, v] of Object.entries(tagged.v)) out[k] = decode(v);
      return out;
    }
  }
}

export class UserDefaults {
  private static standardDefaults: UserDefaults | null = null;
  private static standardStorage: StorageService | null = null;
  private registered: Record<string, PropertyList> = {};
  private readonly namespace: string;

  /** UserDefaults(suiteName:) — null for the app's own (standard) */
  constructor(suiteName: string | null = null) {
    this.namespace = `NSUserDefaults:${suiteName ?? 'standard'}`;
  }

  static get standard(): UserDefaults {
    // A new device (kernel) gets fresh standard defaults.
    const storage = CAEnvironment.kernel?.storage ?? null;
    if (!UserDefaults.standardDefaults || UserDefaults.standardStorage !== storage) {
      UserDefaults.standardDefaults = new UserDefaults();
      UserDefaults.standardStorage = storage;
    }
    return UserDefaults.standardDefaults;
  }

  private get storage(): StorageService {
    const storage = CAEnvironment.kernel?.storage;
    if (!storage) throw new Error('UserDefaults: no device is running (start UIApplication first)');
    return storage;
  }

  // ── writing ───────────────────────────────────────────────────────────

  /** set(_:forKey:) — null removes the value */
  set(value: PropertyList | null | undefined, forKey: string): void {
    if (value === null || value === undefined) {
      this.removeObject(forKey);
      return;
    }
    this.storage.set(this.namespace, forKey, JSON.stringify(encode(value)));
    this.changed();
  }

  removeObject(forKey: string): void {
    this.storage.delete(this.namespace, forKey);
    this.changed();
  }

  /** register(defaults:) */
  register(defaults: Record<string, PropertyList>): void {
    this.registered = { ...this.registered, ...defaults };
  }

  private changed(): void {
    NotificationCenter.default.post(UserDefaultsDidChangeNotification, this);
  }

  /** UserDefaults.resetStandardUserDefaults / removePersistentDomain(forName:) */
  removePersistentDomain(): void {
    this.storage.clear(this.namespace);
    this.changed();
  }

  synchronize(): boolean {
    return true;
  }

  // ── reading ───────────────────────────────────────────────────────────

  /** object(forKey:) */
  object(forKey: string): PropertyList | null {
    const raw = this.storage.get(this.namespace, forKey);
    if (raw !== undefined) {
      try {
        return decode(JSON.parse(raw) as Tagged);
      } catch {
        // Written by something else (a framework's raw string): read it as a string.
        return raw;
      }
    }
    return this.registered[forKey] ?? null;
  }

  string(forKey: string): string | null {
    const v = this.object(forKey);
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    return null;
  }

  integer(forKey: string): number {
    const v = this.object(forKey);
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  }

  double(forKey: string): number {
    const v = this.object(forKey);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return 0;
  }

  float(forKey: string): number {
    return Math.fround(this.double(forKey));
  }

  bool(forKey: string): boolean {
    const v = this.object(forKey);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return /^(yes|true|[1-9])/i.test(v.trim());
    return false;
  }

  array(forKey: string): PropertyList[] | null {
    const v = this.object(forKey);
    return Array.isArray(v) ? v : null;
  }

  stringArray(forKey: string): string[] | null {
    const v = this.array(forKey);
    return v && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  }

  dictionary(forKey: string): Record<string, PropertyList> | null {
    const v = this.object(forKey);
    return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array) ? v : null;
  }

  data(forKey: string): Uint8Array | null {
    const v = this.object(forKey);
    return v instanceof Uint8Array ? v : null;
  }

  url(forKey: string): string | null {
    return this.string(forKey);
  }

  /** dictionaryRepresentation(): registered defaults overlaid by stored values */
  dictionaryRepresentation(): Record<string, PropertyList> {
    const out: Record<string, PropertyList> = { ...this.registered };
    for (const key of this.storage.keys(this.namespace)) {
      const v = this.object(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }
}
