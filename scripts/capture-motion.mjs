#!/usr/bin/env node
/**
 * Record motion references on a simulator / emulator for `mimicry oracle --motion`.
 *
 * For each scene in `<scenes>/motion/*.json`: launch the app and run its
 * setup `steps` (Maestro), start a screen recording, perform the `trigger`
 * step, record for `duration` ms, then extract frames at 60 fps (ffmpeg) to
 * `<out>/<scene>/NNNN.png`. The comparison trims the still lead-in itself,
 * so the moment recording starts doesn't matter.
 *
 *   node scripts/capture-motion.mjs --platform ios --scenes examples/router-stack/scenes \
 *     --out oracle/router-stack/ios-motion --app-id com.example.app [--device <udid|serial>]
 *
 * Requires Maestro, ffmpeg, and xcrun simctl (iOS) or adb (Android).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: 'ios' },
    scenes: { type: 'string' },
    out: { type: 'string' },
    'app-id': { type: 'string' },
    device: { type: 'string' },
  },
});
const platform = values.platform;
const appId = values['app-id'];
if (!values.scenes || !appId) {
  console.error('usage: capture-motion.mjs --platform ios|android --scenes <dir> --app-id <id> [--out dir] [--device id]');
  process.exit(1);
}
const device = values.device ?? (platform === 'ios' ? 'booted' : undefined);
const dir = join(values.scenes, 'motion');
if (!existsSync(dir)) {
  console.log(`no motion scenes in ${dir}`);
  process.exit(0);
}
const out = resolve(values.out ?? `oracle/${platform}-motion`);
mkdirSync(out, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const adbArgs = (...args) => [...(device ? ['-s', device] : []), ...args];
const target = (t) => ('testID' in t ? { id: t.testID } : 'text' in t ? { text: t.text } : { point: `${t.x},${t.y}` });
const maestroStep = (step) => {
  if ('tap' in step) return [`- tapOn: ${JSON.stringify(target(step.tap))}`];
  if ('longPress' in step) return [`- longPressOn: ${JSON.stringify(target(step.longPress))}`];
  if ('back' in step) return ['- back'];
  if ('wait' in step) return [`- waitForAnimationToEnd:\n    timeout: ${step.wait}`];
  if ('scroll' in step) return ['- scroll'];
  throw new Error(`unsupported motion step ${JSON.stringify(step)}`);
};
const maestro = (file, lines) => {
  writeFileSync(file, [`appId: ${appId}`, '---', ...lines].join('\n') + '\n');
  run('maestro', [...(platform === 'android' && device ? ['--device', device] : []), 'test', file]);
};

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const scene = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const isIOS = /^(iphone|ipad)/.test(scene.device ?? 'iphone');
  if ((platform === 'ios') !== isIOS || !scene.trigger) continue;
  if (platform === 'ios') run('xcrun', ['simctl', 'ui', device, 'appearance', scene.appearance ?? 'light']);
  else run('adb', adbArgs('shell', 'cmd', 'uimode', 'night', scene.appearance === 'dark' ? 'yes' : 'no'));

  // 1. set up (launch fresh, run steps, let everything settle)
  maestro(join(out, `${scene.name}.setup.yaml`), ['- launchApp:', '    clearState: true', '- waitForAnimationToEnd', ...(scene.steps ?? []).flatMap(maestroStep), '- waitForAnimationToEnd']);

  // 2. record while the trigger runs
  const video = join(out, `${scene.name}.mp4`);
  let recorder;
  if (platform === 'ios') {
    recorder = spawn('xcrun', ['simctl', 'io', device, 'recordVideo', '--codec=h264', '--force', video], { stdio: 'inherit' });
  } else {
    recorder = spawn('adb', adbArgs('shell', 'screenrecord', '--bit-rate', '12000000', '/sdcard/motion.mp4'), { stdio: 'inherit' });
  }
  await sleep(1500);
  maestro(join(out, `${scene.name}.trigger.yaml`), maestroStep(scene.trigger));
  await sleep((scene.duration ?? 1000) + 800);
  if (platform === 'ios') recorder.kill('SIGINT');
  else execFileSync('adb', adbArgs('shell', 'pkill', '-INT', 'screenrecord'));
  await new Promise((r) => recorder.once('exit', r));
  if (platform === 'android') {
    await sleep(1000);
    run('adb', adbArgs('pull', '/sdcard/motion.mp4', video));
  }

  // 3. frames at 60 fps, at 1x point size
  const frames = join(out, scene.name);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const width = platform === 'ios' ? 402 : 411;
  run('ffmpeg', ['-loglevel', 'error', '-i', video, '-vf', `fps=60,scale=${width}:-2:flags=area`, join(frames, '%04d.png')]);
  writeFileSync(join(frames, 'fps.txt'), '60\n');
  console.log(`recorded ${scene.name}: ${readdirSync(frames).filter((f) => f.endsWith('.png')).length} frames`);
}
