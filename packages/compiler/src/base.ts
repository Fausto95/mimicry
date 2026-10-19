import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * The *base module*: engine + React + react-native + module runtime, bundled
 * once into a Web Worker script. It is content-addressed — the browser caches
 * it forever and an app edit never touches it (Dactyl's base/side split).
 */
export interface BaseBuild {
  code: string;
  hash: string;
  fileName: string;
  bytes: number;
}

const require = createRequire(import.meta.url);

export async function buildBase(options: { minify?: boolean } = {}): Promise<BaseBuild> {
  const entry = require.resolve('@mimicry/runtime/worker');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: !!options.minify,
    sourcemap: 'inline',
    sourcesContent: false,
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis' },
    logLevel: 'silent',
    legalComments: 'none',
  });
  const code = result.outputFiles[0]!.text;
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
  return { code, hash, fileName: `base.${hash}.js`, bytes: Buffer.byteLength(code) };
}
