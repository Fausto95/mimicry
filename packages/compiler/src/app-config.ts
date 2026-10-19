import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

/**
 * Resolves the Expo app config the way `expo config` does for the common
 * cases: app.json, then app.config.{ts,js,mjs,cjs} called with it. The result
 * is what `expo-constants` reports as `expoConfig` / `manifest`.
 */
export async function readAppConfig(root: string): Promise<Record<string, unknown>> {
  let config: Record<string, any> = {};
  const json = join(root, 'app.json');
  if (existsSync(json)) {
    try {
      const raw = JSON.parse(readFileSync(json, 'utf8'));
      config = raw.expo ?? raw;
    } catch {
      // invalid app.json: fall back to defaults below
    }
  }
  for (const name of ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      const out = await build({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', logLevel: 'silent' });
      const module = { exports: {} as any };
      const req = createRequire(file);
      new Function('module', 'exports', 'require', '__filename', '__dirname', out.outputFiles[0]!.text)(module, module.exports, req, file, root);
      const exported = module.exports.default ?? module.exports;
      const result = typeof exported === 'function' ? await exported({ config, projectRoot: root }) : exported;
      if (result && typeof result === 'object') config = (result as any).expo ?? result;
    } catch (error) {
      config = { ...config, _mimicryConfigError: String((error as Error).message ?? error) };
    }
    break;
  }
  const pkg = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};
  return {
    name: pkg.name ?? basename(root),
    slug: pkg.name ?? basename(root),
    version: pkg.version ?? '1.0.0',
    sdkVersion: (pkg.dependencies?.expo ?? '').replace(/^[~^]/, '') || undefined,
    platforms: ['ios', 'android'],
    ...config,
  };
}
