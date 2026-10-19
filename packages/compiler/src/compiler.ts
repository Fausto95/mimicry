import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { providedId, type AppBundle, type ModuleRecord, type PlatformName } from '@mimicry/protocol';
import { assetModule } from './assets';
import { Resolver } from './resolver';
import { errorModule, Transformer } from './transform';
import { buildVendor } from './vendor';

/**
 * Builds the *side module*: the app's own files, compiled one module per
 * file so a hot update ships only what changed. The base module (engine,
 * React, react-native) is built separately and never rebuilt on edits.
 */
export interface CompilerOptions {
  root: string;
  /** maps an asset's absolute path to the URI the host will load */
  assetUrl?: (absolutePath: string) => string;
}

export interface BuildError {
  file?: string;
  message: string;
}

export interface Build {
  bundle: AppBundle;
  errors: BuildError[];
}

export interface Update {
  platform: PlatformName;
  modules: ModuleRecord[];
  errors: BuildError[];
}

const ENTRY_ID = '__mimicry__/entry';
const IGNORED = /(^|[/\\])(node_modules|\.git|\.expo|\.mimicry|ios|android|dist|build)([/\\]|$)/;

export class AppCompiler {
  readonly root: string;
  private readonly resolver: Resolver;
  private readonly transformer: Transformer;
  private readonly assetUrl: (file: string) => string;
  private readonly builds = new Map<PlatformName, Build>();
  private vendorCache = new Map<string, ModuleRecord[]>();
  private watcher: FSWatcher | null = null;

  constructor(options: CompilerOptions) {
    this.root = resolve(options.root);
    this.resolver = new Resolver(this.root);
    this.transformer = new Transformer(this.root);
    this.assetUrl = options.assetUrl ?? ((file) => file);
  }

  private id(file: string): string {
    return relative(this.root, file).split(sep).join('/');
  }

  /** Locates the app entry the way Expo does (package.json main, index, App). */
  entry(): { file: string; register: boolean } {
    const pkgPath = join(this.root, 'package.json');
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
    const main: string | undefined = pkg.main;
    const find = (base: string) => {
      for (const ext of ['.tsx', '.ts', '.jsx', '.js']) if (existsSync(join(this.root, base + ext))) return join(this.root, base + ext);
      return existsSync(join(this.root, base)) ? join(this.root, base) : null;
    };
    if (main && /expo-router\/entry/.test(main)) {
      throw new Error('expo-router projects are not supported yet: Mimicry needs a classic App entry (index.ts with registerRootComponent, or App.tsx).');
    }
    if (main && !/expo\/AppEntry/.test(main)) {
      const file = find(main.replace(/\.(tsx?|jsx?)$/, ''));
      if (file) return { file, register: false };
    }
    // expo/AppEntry (or no main): App.tsx is the root component
    const index = !main ? find('index') : null;
    if (index) return { file: index, register: false };
    const app = find('App');
    if (app) return { file: app, register: true };
    throw new Error(`No entry found in ${this.root} (expected package.json "main", index.tsx or App.tsx).`);
  }

  async build(platform: PlatformName): Promise<Build> {
    const errors: BuildError[] = [];
    const modules = new Map<string, ModuleRecord>();
    const packages = new Set<string>();
    const entry = this.entry();
    const queue: string[] = [];
    let entryId: string;

    if (entry.register) {
      entryId = ENTRY_ID;
      const appId = this.id(entry.file);
      modules.set(ENTRY_ID, {
        id: ENTRY_ID,
        code: `var App = require('./App'); require('expo').registerRootComponent(App && App.__esModule ? App.default : App);`,
        deps: { './App': appId, expo: providedId('expo') },
      });
      queue.push(entry.file);
    } else {
      entryId = this.id(entry.file);
      queue.push(entry.file);
    }

    const seen = new Set<string>();
    while (queue.length) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const id = this.id(file);
      const result = await this.transformer.transform(file);
      if (result.error) errors.push({ file: id, message: result.error });
      const deps: Record<string, string> = {};
      for (const specifier of result.requires) {
        const r = this.resolver.resolve(specifier, file, platform);
        switch (r.kind) {
          case 'file':
            deps[specifier] = this.id(r.path);
            queue.push(r.path);
            break;
          case 'asset': {
            const assetId = this.id(r.path);
            deps[specifier] = assetId;
            if (!modules.has(assetId)) {
              try {
                modules.set(assetId, { id: assetId, code: assetModule(r.path, this.assetUrl), deps: {} });
              } catch (error) {
                modules.set(assetId, { id: assetId, ...errorModule(String(error)), deps: {} });
              }
            }
            break;
          }
          case 'provided':
            deps[specifier] = providedId(r.specifier);
            break;
          case 'package':
            deps[specifier] = `vendor:${r.specifier}`;
            packages.add(r.specifier);
            break;
          case 'error':
            deps[specifier] = `error:${r.message}`;
            errors.push({ file: id, message: r.message });
            break;
        }
      }
      modules.set(id, { id, code: result.code, deps });
    }

    const specifiers = Array.from(packages).sort();
    if (specifiers.length) {
      const key = `${platform}:${specifiers.join(',')}:${lockfileStamp(this.root)}`;
      let vendor = this.vendorCache.get(key);
      if (!vendor) {
        const result = await buildVendor(this.root, specifiers, platform);
        vendor = result.records;
        for (const message of result.errors) errors.push({ message });
        if (!result.errors.length) this.vendorCache.set(key, vendor);
      }
      for (const r of vendor) modules.set(r.id, r);
    }

    const list = Array.from(modules.values());
    const hash = createHash('sha1');
    for (const m of list) hash.update(m.id).update(m.code);
    const build: Build = {
      bundle: { platform, entry: entryId, modules: list, env: readPublicEnv(this.root), hash: hash.digest('hex').slice(0, 12) },
      errors,
    };
    this.builds.set(platform, build);
    return build;
  }

  /** Rebuild every platform that has been built and return what changed. */
  async rebuild(changedFiles: string[] = []): Promise<Update[]> {
    for (const f of changedFiles) this.transformer.invalidate(resolve(this.root, f));
    const updates: Update[] = [];
    for (const [platform, previous] of Array.from(this.builds)) {
      const old = new Map(previous.bundle.modules.map((m) => [m.id, m]));
      const next = await this.build(platform);
      const changed = next.bundle.modules.filter((m) => {
        const before = old.get(m.id);
        return !before || before.code !== m.code || JSON.stringify(before.deps) !== JSON.stringify(m.deps);
      });
      if (changed.length || next.errors.length) updates.push({ platform, modules: changed, errors: next.errors });
    }
    return updates;
  }

  /** Watch the project; `onUpdate` receives changed modules per platform. */
  watch(onUpdate: (updates: Update[]) => void, onError: (error: unknown) => void = console.error): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    let running = Promise.resolve();
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename || IGNORED.test(filename)) return;
      pending.add(filename.toString());
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const files = Array.from(pending);
        pending.clear();
        running = running.then(async () => {
          try {
            const updates = await this.rebuild(files);
            if (updates.length) onUpdate(updates);
          } catch (error) {
            onError(error);
          }
        });
      }, 40);
    });
    return () => {
      this.watcher?.close();
      this.watcher = null;
    };
  }
}

function lockfileStamp(root: string): string {
  for (const name of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'package.json']) {
    const file = join(root, name);
    if (existsSync(file)) return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
  }
  return 'none';
}

/** EXPO_PUBLIC_* variables from .env files, like Expo CLI inlines them. */
function readPublicEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return env;
}
