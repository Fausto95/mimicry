import { transform as swcTransform } from '@swc/core';
import { readFile, stat } from 'node:fs/promises';

/**
 * Per-file transform (TypeScript/JSX → CommonJS with React Refresh
 * registration), cached by path + mtime + size. Output is platform
 * independent; platform only affects resolution.
 */
export interface TransformResult {
  code: string;
  /** require() specifiers found in the output */
  requires: string[];
  error?: string;
}

interface CacheEntry {
  key: string;
  result: TransformResult;
}

// SWC keeps comments that followed an import inside the call: require("./x" // note\n)
const REQUIRE = /\brequire\(\s*(['"])([^'"]+)\1(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*\)/g;

export class Transformer {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly root: string) {}

  async transform(file: string): Promise<TransformResult> {
    const info = await stat(file);
    const key = `${info.mtimeMs}:${info.size}`;
    const hit = this.cache.get(file);
    if (hit && hit.key === key) return hit.result;
    const source = await readFile(file, 'utf8');
    const result = await this.transformSource(file, source);
    this.cache.set(file, { key, result });
    return result;
  }

  async transformSource(file: string, source: string): Promise<TransformResult> {
    // CSS is web-only; on native, Expo's Metro config resolves it to an empty module.
    if (file.endsWith('.css')) return { code: file.endsWith('.module.css') ? 'module.exports = new Proxy({}, { get: function (_t, k) { return k; } });' : 'module.exports = {};', requires: [] };
    if (file.endsWith('.json')) {
      try {
        JSON.parse(source);
        return { code: `module.exports = ${source};`, requires: [] };
      } catch (error) {
        return errorModule(`Invalid JSON in ${this.relative(file)}: ${(error as Error).message}`);
      }
    }
    const ts = /\.tsx?$/.test(file);
    const tsx = file.endsWith('.tsx');
    try {
      const out = await swcTransform(source, {
        filename: file,
        sourceFileName: this.relative(file),
        sourceMaps: 'inline',
        jsc: {
          parser: ts ? { syntax: 'typescript', tsx } : { syntax: 'ecmascript', jsx: true },
          target: 'es2022',
          transform: {
            react: { runtime: 'automatic', development: true, refresh: true, importSource: 'react' },
          },
        },
        module: { type: 'commonjs', ignoreDynamic: false },
      });
      const requires = new Set<string>();
      for (const m of out.code.matchAll(REQUIRE)) requires.add(m[2]!);
      return { code: out.code, requires: Array.from(requires) };
    } catch (error) {
      return errorModule(formatSwcError(this.relative(file), error));
    }
  }

  invalidate(file: string): void {
    this.cache.delete(file);
  }

  private relative(file: string): string {
    return file.startsWith(this.root + '/') ? file.slice(this.root.length + 1) : file;
  }
}

function formatSwcError(file: string, error: unknown): string {
  const raw = String((error as Error)?.message ?? error);
  // SWC messages carry ANSI codes and a code frame
  const clean = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return `${file}: ${clean}`;
}

export function errorModule(message: string): TransformResult {
  return {
    code: `var e = new SyntaxError(${JSON.stringify(message)}); e.name = 'SyntaxError'; throw e;`,
    requires: [],
    error: message,
  };
}
