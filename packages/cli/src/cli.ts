import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEVICES } from '@mimicry/protocol';
import { startDevServer } from './dev-server';
import { runStep, type Scene } from './scenes';

const HELP = `mimicry — a browser-native simulator for React Native apps

Usage
  mimicry dev [project]              Open the Studio for an Expo / React Native project
      --port <n>                     default 5173
      --host <addr>                  default 127.0.0.1
  mimicry render <project>           Render a screenshot headlessly
      --device <id> --appearance light|dark --orientation portrait|landscape
      --scene <scene.json>           steps to run before the capture
      --out <file.png>
  mimicry filmstrip <project> --scene <scene.json> --out <dir>
                                     Sample frames on a virtual clock (duration/every in the scene)
  mimicry diff <a.png> <b.png> [--out diff.png] [--threshold 0.1]
  mimicry oracle <project> --scenes <dir> --reference <dir> --out <dir>
                                     Compare engine renders with real simulator captures
  mimicry devices                    List device descriptors
`;

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'dev':
      return dev(rest);
    case 'render':
      return render(rest);
    case 'filmstrip':
      return filmstrip(rest);
    case 'diff':
      return diff(rest);
    case 'oracle':
      return oracle(rest);
    case 'devices':
      for (const d of DEVICES) console.log(`${d.id.padEnd(20)} ${d.platform.padEnd(8)} ${`${d.width}×${d.height}`.padEnd(10)} @${d.scale}x  ${d.name}`);
      return;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

async function dev(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { port: { type: 'string', default: process.env.MIMICRY_PORT ?? '5173' }, host: { type: 'string', default: '127.0.0.1' } },
  });
  const project = resolve(positionals[0] ?? '.');
  console.log(`\n  mimicry  ${project}\n`);
  const server = await startDevServer({ project, port: Number(values.port), host: values.host! });
  console.log(`\n  Studio        ${server.url}\n`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function loadScene(path: string | undefined): Promise<Scene | null> {
  if (!path) return null;
  return JSON.parse(await readFile(path, 'utf8')) as Scene;
}

async function openProject(project: string, scene: Scene | null, overrides: { device?: string; appearance?: string; orientation?: string }) {
  const { launch } = await import('@mimicry/testing');
  const app = await launch(resolve(project), {
    device: overrides.device ?? scene?.device ?? 'iphone-17-pro',
    appearance: (overrides.appearance ?? scene?.appearance ?? 'light') as 'light' | 'dark',
    orientation: (overrides.orientation ?? scene?.orientation ?? 'portrait') as 'portrait' | 'landscape',
  });
  for (const e of app.buildErrors) console.error(`build error: ${e.file ?? ''} ${e.message}`);
  return app;
}

async function render(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      device: { type: 'string' }, appearance: { type: 'string' }, orientation: { type: 'string' },
      scene: { type: 'string' }, out: { type: 'string', default: 'mimicry.png' },
    },
  });
  const scene = await loadScene(values.scene);
  const app = await openProject(positionals[0] ?? '.', scene, values);
  for (const step of scene?.steps ?? []) runStep(app.session, step);
  await app.session.ready();
  await writeFile(values.out!, app.session.screenshot());
  for (const e of app.session.errors) console.error(`${e.kind} error: ${e.message}`);
  console.log(`wrote ${values.out}`);
  app.session.dispose();
}

async function filmstrip(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { scene: { type: 'string' }, out: { type: 'string', default: 'filmstrip' }, device: { type: 'string' }, appearance: { type: 'string' } },
  });
  const { stripPng } = await import('@mimicry/testing');
  const scene = await loadScene(values.scene);
  const app = await openProject(positionals[0] ?? '.', scene, values);
  const steps = scene?.steps ?? [];
  const every = scene?.every ?? 100;
  const duration = scene?.duration ?? 1000;
  // Steps run at t=0 in order; 'wait' steps shift subsequent ones.
  let at = 0;
  const actions = steps.map((step) => {
    const action = { at, run: () => runStep(app.session, step) };
    if ('wait' in step) at += step.wait;
    return action;
  }).filter((_, i) => !('wait' in steps[i]!));
  const frames = app.session.filmstrip({ duration, every, actions, scale: 1 });
  await mkdir(values.out!, { recursive: true });
  for (const f of frames) await writeFile(join(values.out!, `frame-${String(f.time).padStart(5, '0')}.png`), f.png);
  await writeFile(join(values.out!, 'strip.png'), stripPng(frames.map((f) => f.png)));
  console.log(`wrote ${frames.length} frames to ${values.out}`);
  app.session.dispose();
}

async function diff(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' }, threshold: { type: 'string', default: '0.1' } },
  });
  const { diffPng } = await import('@mimicry/testing');
  const [a, b] = positionals;
  if (!a || !b) throw new Error('diff needs two PNG files');
  const result = diffPng(await readFile(a), await readFile(b), { threshold: Number(values.threshold) });
  if (values.out) await writeFile(values.out, result.diff);
  console.log(`${(result.ratio * 100).toFixed(3)}% of pixels differ (${result.mismatched} px)${result.sizeMismatch ? ' — sizes differ' : ''}`);
}

async function oracle(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { scenes: { type: 'string' }, reference: { type: 'string' }, out: { type: 'string', default: 'oracle-report' }, threshold: { type: 'string', default: '0.1' } },
  });
  if (!values.scenes || !values.reference) throw new Error('oracle needs --scenes and --reference');
  const { diffPng } = await import('@mimicry/testing');
  const project = positionals[0] ?? '.';
  await mkdir(values.out!, { recursive: true });
  const rows: Array<{ name: string; ratio: number | null; note?: string }> = [];
  for (const file of (await readdir(values.scenes)).filter((f) => f.endsWith('.json')).sort()) {
    const scene = JSON.parse(await readFile(join(values.scenes, file), 'utf8')) as Scene;
    const name = scene.name ?? basename(file, '.json');
    const app = await openProject(project, scene, {});
    for (const step of scene.steps ?? []) runStep(app.session, step);
    await app.session.ready();
    const ours = app.session.screenshot();
    app.session.dispose();
    await writeFile(join(values.out!, `${name}.mimicry.png`), ours);
    const refPath = join(values.reference, `${name}.png`);
    if (!existsSync(refPath)) {
      rows.push({ name, ratio: null, note: 'no reference capture' });
      continue;
    }
    const ref = await readFile(refPath);
    await writeFile(join(values.out!, `${name}.reference.png`), ref);
    const result = diffPng(ours, ref, { threshold: Number(values.threshold) });
    await writeFile(join(values.out!, `${name}.diff.png`), result.diff);
    rows.push({ name, ratio: result.ratio, note: result.sizeMismatch ? 'size mismatch' : undefined });
  }
  await writeFile(join(values.out!, 'index.html'), oracleReport(rows));
  for (const r of rows) console.log(`${r.name.padEnd(28)} ${r.ratio == null ? '—' : `${(r.ratio * 100).toFixed(2)}%`} ${r.note ?? ''}`);
  console.log(`report: ${join(values.out!, 'index.html')}`);
}

function oracleReport(rows: Array<{ name: string; ratio: number | null; note?: string }>): string {
  const body = rows
    .map((r) => `<section><h2>${r.name} <small>${r.ratio == null ? r.note : `${(r.ratio * 100).toFixed(2)}% differ`}${r.note && r.ratio != null ? ` · ${r.note}` : ''}</small></h2>
<div class="row"><figure><img src="${r.name}.mimicry.png"><figcaption>Mimicry</figcaption></figure>${r.ratio == null ? '' : `<figure><img src="${r.name}.reference.png"><figcaption>Simulator</figcaption></figure><figure><img src="${r.name}.diff.png"><figcaption>Difference</figcaption></figure>`}</div></section>`)
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Mimicry oracle report</title>
<style>body{font:14px system-ui;margin:24px;background:#f3f4f6;color:#1f2329}h2{font-size:16px}small{color:#6b7280;font-weight:400;margin-left:8px}.row{display:flex;gap:16px}figure{margin:0}img{width:260px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.12)}figcaption{color:#6b7280;margin-top:6px}</style>
<h1>Engine vs simulator</h1>${body}`;
}
