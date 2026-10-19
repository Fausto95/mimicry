import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PlatformName } from '@mimicry/protocol';
import { isProvidedSpecifier } from '@mimicry/protocol';
import { isAsset } from './assets';

/**
 * Metro-compatible resolution for app source: platform extensions
 * (Button.ios.tsx → Button.native.tsx → Button.tsx), directory indexes,
 * tsconfig `paths`, and the provided/vendor split for bare imports.
 */
export type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'asset'; path: string }
  | { kind: 'provided'; specifier: string }
  | { kind: 'package'; specifier: string }
  | { kind: 'error'; message: string };

const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];

export function platformExtensions(platform: PlatformName): string[] {
  const out: string[] = [];
  for (const ext of SOURCE_EXTS) out.push(`.${platform}${ext}`);
  for (const ext of SOURCE_EXTS) out.push(`.native${ext}`);
  out.push(...SOURCE_EXTS, '.json');
  return out;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

interface PathAlias {
  prefix: string;
  suffix: string;
  targets: string[];
}

export class Resolver {
  private readonly aliases: PathAlias[];

  constructor(readonly root: string) {
    this.aliases = readPathAliases(root);
  }

  resolve(specifier: string, fromFile: string, platform: PlatformName): Resolution {
    if (isProvidedSpecifier(specifier)) return { kind: 'provided', specifier };
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
      const base = isAbsolute(specifier) ? specifier : resolve(dirname(fromFile), specifier);
      return this.resolvePath(base, platform) ?? { kind: 'error', message: `Unable to resolve "${specifier}" from "${fromFile.replace(this.root + '/', '')}".` };
    }
    for (const alias of this.aliases) {
      if (specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix)) {
        const middle = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
        for (const target of alias.targets) {
          const hit = this.resolvePath(target.replace('*', middle), platform);
          if (hit) return hit;
        }
      }
    }
    return { kind: 'package', specifier };
  }

  private resolvePath(base: string, platform: PlatformName): Resolution | null {
    if (isAsset(base)) return existsSync(base) || existsAnyVariant(base) ? { kind: 'asset', path: base } : null;
    const exts = platformExtensions(platform);
    // explicit extension
    if (/\.(tsx?|jsx?|mjs|cjs|json|css)$/.test(base) && isFile(base)) return { kind: 'file', path: base };
    for (const ext of exts) {
      if (isFile(base + ext)) return { kind: 'file', path: base + ext };
    }
    if (isDir(base)) {
      const pkg = join(base, 'package.json');
      if (isFile(pkg)) {
        try {
          const main = JSON.parse(readFileSync(pkg, 'utf8')).main;
          if (main) {
            const hit = this.resolvePath(resolve(base, main), platform);
            if (hit) return hit;
          }
        } catch {
          // fall through to index
        }
      }
      for (const ext of exts) {
        const index = join(base, 'index' + ext);
        if (isFile(index)) return { kind: 'file', path: index };
      }
    }
    return null;
  }
}

function existsAnyVariant(file: string): boolean {
  const m = /^(.*?)(\.[a-z]+)$/i.exec(file);
  if (!m) return false;
  return existsSync(`${m[1]}@2x${m[2]}`) || existsSync(`${m[1]}@3x${m[2]}`);
}

function readPathAliases(root: string): PathAlias[] {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
      const options = json.compilerOptions ?? {};
      const baseUrl = resolve(root, options.baseUrl ?? '.');
      const paths: Record<string, string[]> = options.paths ?? {};
      const aliases = Object.entries(paths).map(([pattern, targets]) => {
        const star = pattern.indexOf('*');
        return {
          prefix: star >= 0 ? pattern.slice(0, star) : pattern,
          suffix: star >= 0 ? pattern.slice(star + 1) : '',
          targets: targets.map((t) => resolve(baseUrl, t)),
        };
      });
      // Expo's default `@/*` alias when the project relies on it implicitly
      if (!aliases.some((a) => a.prefix === '@/')) aliases.push({ prefix: '@/', suffix: '', targets: [resolve(root, '*')] });
      return aliases;
    } catch {
      return [];
    }
  }
  return [{ prefix: '@/', suffix: '', targets: [resolve(root, '*')] }];
}

export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
