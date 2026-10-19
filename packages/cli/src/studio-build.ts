import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Bundles the Studio page (TypeScript + CSS) for the dev server. */
export async function buildStudio(): Promise<{ js: string; css: string }> {
  const dir = dirname(require.resolve('@mimicry/studio/package.json'));
  const result = await build({
    entryPoints: [join(dir, 'src/main.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  const css = await readFile(join(dir, 'src/studio.css'), 'utf8');
  return { js: result.outputFiles[0]!.text, css };
}

export const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mimicry</title>
<link rel="stylesheet" href="/__mimicry/studio.css">
</head>
<body>
<script type="module" src="/__mimicry/studio.js"></script>
</body>
</html>`;
