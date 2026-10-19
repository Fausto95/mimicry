#!/usr/bin/env node
/**
 * Capture oracle screenshots on a real iOS Simulator or Android emulator.
 *
 * The same scene JSON that drives `mimicry render` drives the device, so
 * `mimicry oracle` can diff the two. The simulator is a test oracle, never a
 * runtime dependency: run this offline (or in CI, see .github/workflows/oracle.yml)
 * when you want fresh references.
 *
 *   node scripts/capture-oracle.mjs --platform ios --scenes examples/showcase/scenes \
 *     --out oracle/ios --app-id com.example.showcase [--device <udid|serial>]
 *
 * Requirements: Maestro (https://maestro.mobile.dev) for taps by testID, and a
 * build of the app installed on the device. iOS needs Xcode (xcrun simctl);
 * Android needs adb with one emulator running.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: 'ios' },
    scenes: { type: 'string' },
    out: { type: 'string' },
    'app-id': { type: 'string' },
    'bundle-id': { type: 'string' }, // alias of --app-id
    device: { type: 'string' },
    simulator: { type: 'string' }, // alias of --device
    only: { type: 'string' },
  },
});
const platform = values.platform;
const appId = values['app-id'] ?? values['bundle-id'];
if (!values.scenes || !appId || (platform !== 'ios' && platform !== 'android')) {
  console.error('usage: capture-oracle.mjs --platform ios|android --scenes <dir> --app-id <id> [--out dir] [--device id] [--only a,b]');
  process.exit(1);
}

const device = values.device ?? values.simulator ?? (platform === 'ios' ? 'booted' : undefined);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const adb = (...args) => run('adb', [...(device ? ['-s', device] : []), ...args]);
const out = resolve(values.out ?? `oracle/${platform}`);
mkdirSync(out, { recursive: true });
const only = values.only ? new Set(values.only.split(',')) : null;

const isScenePlatform = (scene) => {
  const id = scene.device ?? (platform === 'ios' ? 'iphone-17-pro' : 'pixel-9');
  return platform === 'ios' ? /^(iphone|ipad)/.test(id) : /^(pixel|galaxy)/.test(id);
};

function pinStatusBar() {
  if (platform === 'ios') {
    // Match the engine's chrome: 9:41, full bars, full battery.
    run('xcrun', ['simctl', 'status_bar', device, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiBars', '3', '--cellularBars', '4', '--batteryState', 'discharging', '--batteryLevel', '100']);
    return;
  }
  // SystemUI demo mode: 12:30, full wifi and cell, 100% battery, no notification icons.
  adb('shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1');
  const demo = (...extras) => adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', ...extras);
  demo('enter');
  demo('clock', '-e', 'hhmm', '1230');
  demo('network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'fully', 'true');
  demo('network', '-e', 'mobile', 'show', '-e', 'datatype', 'none', '-e', 'level', '4', '-e', 'fully', 'true');
  demo('battery', '-e', 'level', '100', '-e', 'plugged', 'false');
  demo('notifications', '-e', 'visible', 'false');
}

function setAppearance(appearance) {
  if (platform === 'ios') run('xcrun', ['simctl', 'ui', device, 'appearance', appearance]);
  else adb('shell', 'cmd', 'uimode', 'night', appearance === 'dark' ? 'yes' : 'no');
}

function screenshot(file) {
  if (platform === 'ios') run('xcrun', ['simctl', 'io', device, 'screenshot', '--type=png', file]);
  else writeFileSync(file, execFileSync('adb', [...(device ? ['-s', device] : []), 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
}

pinStatusBar();

const target = (t) => ('testID' in t ? { id: t.testID } : 'text' in t ? { text: t.text } : 'label' in t ? { text: t.label } : { point: `${t.x},${t.y}` });

for (const file of readdirSync(values.scenes).filter((f) => f.endsWith('.json')).sort()) {
  const scene = JSON.parse(readFileSync(join(values.scenes, file), 'utf8'));
  if (!isScenePlatform(scene) || (only && !only.has(scene.name))) continue;
  setAppearance(scene.appearance ?? 'light');
  const flow = [`appId: ${appId}`, '---', '- launchApp:', '    clearState: true', '- waitForAnimationToEnd'];
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
  run('maestro', [...(device && platform === 'android' ? ['--device', device] : []), 'test', flowFile]);
  screenshot(join(out, `${scene.name}.png`));
  console.log(`captured ${scene.name}`);
}
if (platform === 'ios') run('xcrun', ['simctl', 'status_bar', device, 'clear']);
else adb('shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit');
