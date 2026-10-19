import { build } from 'esbuild';
import { PROVIDED_MODULE_IDS, providedId, type ModuleRecord, type PlatformName } from '@mimicry/protocol';
import { platformExtensions } from './resolver';

/**
 * Third-party packages the app imports (anything not provided by the base)
 * are prebundled once with esbuild into a single CommonJS module, cached by
 * the set of specifiers — the same idea as Vite's dependency optimizer.
 */
export const VENDOR_BUNDLE_ID = 'vendor:__bundle__';

export interface VendorResult {
  records: ModuleRecord[];
  errors: string[];
}

export async function buildVendor(root: string, specifiers: string[], platform: PlatformName): Promise<VendorResult> {
  if (!specifiers.length) return { records: [], errors: [] };
  const entry = `module.exports = {\n${specifiers.map((s) => `  ${JSON.stringify(s)}: require(${JSON.stringify(s)}),`).join('\n')}\n};`;
  try {
    const result = await build({
      stdin: { contents: entry, resolveDir: root, sourcefile: 'mimicry-vendor.js', loader: 'js' },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      mainFields: ['react-native', 'browser', 'module', 'main'],
      conditions: ['react-native', 'browser', 'import', 'require', 'default'],
      resolveExtensions: platformExtensions(platform),
      external: [...PROVIDED_MODULE_IDS],
      loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
      define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"', global: 'globalThis' },
      logLevel: 'silent',
      sourcemap: false,
    });
    const js = result.outputFiles[0];
    const deps: Record<string, string> = {};
    for (const id of PROVIDED_MODULE_IDS) deps[id] = providedId(id);
    const records: ModuleRecord[] = [{ id: VENDOR_BUNDLE_ID, code: js?.text ?? 'module.exports = {};', deps }];
    for (const s of specifiers) {
      records.push({ id: `vendor:${s}`, code: `module.exports = require(${JSON.stringify(VENDOR_BUNDLE_ID)})[${JSON.stringify(s)}];`, deps: { [VENDOR_BUNDLE_ID]: VENDOR_BUNDLE_ID } });
    }
    return { records, errors: [] };
  } catch (error) {
    const errors = ((error as { errors?: Array<{ text: string; location?: { file: string; line: number } }> }).errors ?? []).map(
      (e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ''}${e.text}`,
    );
    const message = errors.length ? errors.join('\n') : String(error);
    const records = specifiers.map((s) => ({
      id: `vendor:${s}`,
      code: `var e = new Error(${JSON.stringify(`Could not bundle "${s}":\n${message}`)}); throw e;`,
      deps: {},
    }));
    return { records, errors: [message] };
  }
}
