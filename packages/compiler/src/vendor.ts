import { build, type Plugin } from 'esbuild';
import flowRemoveTypes from 'flow-remove-types';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { isProvidedSpecifier, PROVIDED_MODULE_IDS, providedId, type ModuleRecord, type PlatformName } from '@mimicry/protocol';
import { ASSET_REGISTRY, imageSize, resolveAssetVariant } from './assets';
import { platformExtensions } from './resolver';

/**
 * Third-party packages the app imports (anything not provided by the base)
 * are prebundled once with esbuild into a single CommonJS module, cached by
 * the set of specifiers — the same idea as Vite's dependency optimizer.
 *
 * Inside the bundle, imports of provided modules (react, react-native and its
 * deep paths, the native-side shims) stay external so every package links to
 * the base's single copy.
 */
export const VENDOR_BUNDLE_ID = 'vendor:__bundle__';
/** Must match compiler.ts: the app-side module implementing expo-router's `require.context`. */
const ROUTER_CONTEXT_ID = '__mimicry__/router-context';

export interface VendorResult {
  records: ModuleRecord[];
  errors: string[];
}

function mimicryPlugin(): Plugin {
  return {
    name: 'mimicry-vendor',
    setup(b) {
      // expo-router reads the app directory through Metro's require.context.
      b.onResolve({ filter: /^expo-router\/_ctx(\.[a-z]+)?(\.js)?$/ }, () => ({ path: ROUTER_CONTEXT_ID, external: true }));
      b.onResolve({ filter: /^[^./]/ }, (args) => {
        if (isProvidedSpecifier(args.path)) return { path: args.path, external: true };
        return undefined;
      });
      // Some packages still publish Flow-typed JavaScript (Metro strips it with Babel).
      b.onLoad({ filter: /[/\\]node_modules[/\\].*\.jsx?$/ }, (args) => {
        const source = readFileSync(args.path, 'utf8');
        if (!/@flow\b|^\s*(import|export) type\b|^\s*import typeof\b/m.test(source)) return undefined;
        return { contents: flowRemoveTypes(source, { all: true }).toString(), loader: 'jsx' };
      });
      // Fonts inside packages (icon fonts) register as assets for expo-font.
      b.onLoad({ filter: /\.(ttf|otf)$/i }, (args) => {
        const ext = extname(args.path).slice(1).toLowerCase();
        const asset = { uri: `data:font/${ext};base64,${readFileSync(args.path).toString('base64')}`, width: 0, height: 0, scale: 1, type: ext, name: basename(args.path, '.' + ext) };
        return { contents: `module.exports = require(${JSON.stringify(ASSET_REGISTRY)}).registerAsset(${JSON.stringify(asset)});`, loader: 'js' };
      });
      // Images inside packages register with the asset registry like Metro's assets.
      b.onLoad({ filter: /\.(png|jpe?g|gif|webp|bmp)$/i }, (args) => {
        const variant = resolveAssetVariant(args.path);
        const bytes = readFileSync(variant.file);
        const size = imageSize(bytes) ?? { width: 0, height: 0 };
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[
          extname(variant.file).toLowerCase()
        ];
        const asset = {
          uri: `data:${mime};base64,${bytes.toString('base64')}`,
          width: size.width / variant.scale,
          height: size.height / variant.scale,
          scale: variant.scale,
        };
        return { contents: `module.exports = require(${JSON.stringify(ASSET_REGISTRY)}).registerAsset(${JSON.stringify(asset)});`, loader: 'js' };
      });
    },
  };
}

export async function buildVendor(root: string, specifiers: string[], platform: PlatformName): Promise<VendorResult> {
  if (!specifiers.length) return { records: [], errors: [] };
  const entry = `module.exports = {\n${specifiers.map((s) => `  ${JSON.stringify(s)}: function () { return require(${JSON.stringify(s)}); },`).join('\n')}\n};`;
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
      plugins: [mimicryPlugin()],
      loader: {
        '.js': 'jsx', '.css': 'empty', '.svg': 'empty', '.mp4': 'empty', '.mp3': 'empty',
        '.wav': 'empty', '.lottie': 'empty', '.html': 'text', '.md': 'text',
      },
      define: {
        __DEV__: 'true',
        'process.env.NODE_ENV': '"development"',
        'process.env.EXPO_OS': JSON.stringify(platform),
        'process.env.EXPO_ROUTER_IMPORT_MODE': '"sync"',
        global: 'globalThis',
      },
      logLevel: 'silent',
      sourcemap: false,
    });
    const js = result.outputFiles[0];
    const deps: Record<string, string> = { [ROUTER_CONTEXT_ID]: ROUTER_CONTEXT_ID };
    for (const id of PROVIDED_MODULE_IDS) deps[id] = providedId(id);
    const records: ModuleRecord[] = [{ id: VENDOR_BUNDLE_ID, code: js?.text ?? 'module.exports = {};', deps }];
    // Each package is evaluated on first require, so one package's failure
    // (or side effects) doesn't take down the others.
    for (const s of specifiers) {
      records.push({ id: `vendor:${s}`, code: `module.exports = require(${JSON.stringify(VENDOR_BUNDLE_ID)})[${JSON.stringify(s)}]();`, deps: { [VENDOR_BUNDLE_ID]: VENDOR_BUNDLE_ID } });
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

