#!/usr/bin/env node
/**
 * Capture oracle screenshots on a real iOS Simulator (macOS only).
 *
 * The same scene JSON that drives `mimicry render` drives the simulator, so
 * `mimicry oracle` can diff the two. The simulator is a test oracle, never a
 * runtime dependency: run this offline when you want fresh references.
 *
 *   node scripts/capture-oracle.mjs --project examples/showcase \
 *     --scenes examples/showcase/scenes --out oracle/ios --bundle-id com.example.showcase
 *
 * Requirements: Xcode command line tools (xcrun simctl), Maestro
 * (https://maestro.mobile.dev) for taps by testID, and a development build
 * of the app installed on the booted simulator (`npx expo run:ios`).
 *
 * NOTE: written against simctl/Maestro documented behavior; it has not been
 * run in Mimicry's CI (no macOS runner yet).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    project: { type: 'string', default: '.' },
    scenes: { type: 'string' },
    out: { type: 'string', default: 'oracle/ios' },
    'bundle-id': { type: 'string' },
    simulator: { type: 'string', default: 'booted' },
  },
});
if (!values.scenes || !values['bundle-id']) {
  console.error('usage: capture-oracle.mjs --scenes <dir> --bundle-id <id> [--out dir] [--simulator udid]');
  process.exit(1);
}

const sim = values.simulator;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

// Match the engine's chrome: 9:41, full bars, full battery.
run('xcrun', ['simctl', 'status_bar', sim, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiBars', '3', '--cellularBars', '4', '--batteryState', 'discharging', '--batteryLevel', '100']);

const target = (t) => ('testID' in t ? { id: t.testID } : 'text' in t ? { text: t.text } : 'label' in t ? { text: t.label } : { point: `${t.x},${t.y}` });

for (const file of readdirSync(values.scenes).filter((f) => f.endsWith('.json')).sort()) {
  const scene = JSON.parse(readFileSync(join(values.scenes, file), 'utf8'));
  if (scene.device && !scene.device.startsWith('iphone') && !scene.device.startsWith('ipad')) continue;
  run('xcrun', ['simctl', 'ui', sim, 'appearance', scene.appearance ?? 'light']);
  const flow = [`appId: ${values['bundle-id']}`, '---', '- launchApp:', '    clearState: true', '- waitForAnimationToEnd'];
  for (const step of scene.steps ?? []) {
    if ('tap' in step) flow.push(`- tapOn: ${JSON.stringify(target(step.tap))}`);
    else if ('longPress' in step) flow.push(`- longPressOn: ${JSON.stringify(target(step.longPress))}`);
    else if ('type' in step) flow.push(`- tapOn: ${JSON.stringify(target(step.type))}`, `- inputText: ${JSON.stringify(step.text)}`);
    else if ('scroll' in step) flow.push('- scroll');
    else if ('wait' in step) flow.push(`- waitForAnimationToEnd:\n    timeout: ${step.wait}`);
    else if ('back' in step) flow.push('- back');
  }
  flow.push('- waitForAnimationToEnd');
  const flowFile = join(out, `${scene.name}.maestro.yaml`);
  writeFileSync(flowFile, flow.join('\n') + '\n');
  run('maestro', ['test', flowFile]);
  run('xcrun', ['simctl', 'io', sim, 'screenshot', '--type=png', join(out, `${scene.name}.png`)]);
  console.log(`captured ${scene.name}`);
}
run('xcrun', ['simctl', 'status_bar', sim, 'clear']);
