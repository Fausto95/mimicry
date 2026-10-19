import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createDevice, type Device, type DeviceOptions } from '@mimicry/testing';
import { UIColor, UIViewController, type UIWindow } from '@mimicry/os-ios';

/** A device with one key window whose root view controller has a white view. */
export function boot(options: DeviceOptions = {}): { device: Device; window: UIWindow; root: UIViewController } {
  const device = createDevice({ device: 'iphone-17-pro', ...options });
  const window = device.ios.application.makeWindow();
  const root = new UIViewController();
  root.view.backgroundColor = UIColor.white;
  window.rootViewController = root;
  window.makeKeyAndVisible();
  device.advance(32);
  return { device, window, root };
}

export interface Image {
  width: number;
  height: number;
  data: Buffer;
}

export function decode(png: Buffer): Image {
  return PNG.sync.read(png);
}

/** [r, g, b] at a point (in pixels of the image). */
export function pixelAt(img: Image, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/** [r, g, b] at a point of a 1× screenshot. */
export function pixel(device: Device, x: number, y: number): [number, number, number] {
  return pixelAt(decode(device.screenshot(1)), x, y);
}

export const close = (a: readonly number[], b: readonly number[], tolerance = 6) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../artifacts/os-ios');

/** Save a screenshot for a human (or Claude) to look at. */
export function saveArtifact(name: string, png: Buffer): string {
  mkdirSync(root, { recursive: true });
  const file = join(root, name);
  writeFileSync(file, png);
  return file;
}
