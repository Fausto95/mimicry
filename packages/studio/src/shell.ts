import type { DeviceDescriptor } from '@mimicry/protocol';

/**
 * Physical enclosure presentation is deliberately a Studio concern:
 * it never changes the app viewport, rendering protocol or screenshot pixels.
 * A finish controls the side rail, highlight and hardware controls only.
 */
export interface ShellFinish {
  id: string;
  name: string;
  rail: string;
  light: string;
  dark: string;
}

const finish = (id: string, name: string, rail: string, light: string, dark: string): ShellFinish =>
  ({ id, name, rail, light, dark });

const PALETTES = {
  iphone18: [
    finish('burgundy', 'Burgundy', '#784052', '#b57b88', '#42232d'),
    finish('black', 'Black', '#36363a', '#77777c', '#141418'),
    finish('silver', 'Silver', '#bfc0c4', '#f4f4f6', '#63656e'),
    finish('glacier', 'Glacier', '#9cbbd1', '#daeefa', '#58758d'),
  ],
  iphone17: [
    finish('orange', 'Cosmic Orange', '#b85d2f', '#f0a371', '#703b2c'),
    finish('blue', 'Deep Blue', '#2b415b', '#879db5', '#131e2c'),
    finish('silver', 'Silver', '#bfc0c4', '#f5f5f8', '#656970'),
  ],
  iphone16: [
    finish('black', 'Black Titanium', '#3d3c3c', '#7b7774', '#191919'),
    finish('natural', 'Natural Titanium', '#97918a', '#dedbd3', '#5b564e'),
    finish('white', 'White Titanium', '#d6d6d2', '#ffffff', '#979994'),
    finish('desert', 'Desert Titanium', '#ac8f7e', '#e5c8b0', '#715a50'),
  ],
  iphone: [
    finish('black', 'Black', '#38383d', '#77777e', '#151518'),
    finish('silver', 'Silver', '#c4c8cc', '#ffffff', '#737982'),
  ],
  ipad: [
    finish('space-black', 'Space Black', '#48494e', '#85858c', '#222328'),
    finish('silver', 'Silver', '#bdc0c6', '#f6f6f8', '#73757b'),
  ],
  pixel: [
    finish('obsidian', 'Obsidian', '#4a4b4e', '#8f9295', '#1b1d20'),
    finish('fog', 'Fog', '#b1b6bf', '#f2f4f8', '#6b737b'),
    finish('olive', 'Olive', '#69725b', '#a8b496', '#3b463a'),
    finish('canyon', 'Canyon', '#9c6d62', '#d9aaa0', '#573e3d'),
  ],
  galaxy: [
    finish('black', 'Black', '#3f414a', '#858890', '#1a1b21'),
    finish('silver', 'Silver', '#a7aeb8', '#e3e7eb', '#606977'),
  ],
  android: [
    finish('graphite', 'Graphite', '#4b4c52', '#9a9ba2', '#1e2025'),
  ],
} satisfies Record<string, ShellFinish[]>;

export type ShellFamily = keyof typeof PALETTES;

export function shellFamily(device: DeviceDescriptor): ShellFamily {
  if (device.platform === 'android') {
    if (device.id.startsWith('pixel')) return 'pixel';
    if (device.id.startsWith('galaxy')) return 'galaxy';
    return 'android';
  }
  if (device.idiom === 'tablet') return 'ipad';
  if (device.id.startsWith('iphone-18')) return 'iphone18';
  if (device.id.startsWith('iphone-17-pro')) return 'iphone17';
  if (device.id.startsWith('iphone-16-pro')) return 'iphone16';
  return 'iphone';
}

export function finishesFor(device: DeviceDescriptor): readonly ShellFinish[] {
  return PALETTES[shellFamily(device)];
}

export function finishFor(device: DeviceDescriptor, requested?: string): ShellFinish {
  const available = finishesFor(device);
  return available.find((f) => f.id === requested) ?? available[0]!;
}

export function hardwareLabel(device: DeviceDescriptor): string {
  const family = shellFamily(device);
  if (family === 'ipad') return 'aluminum tablet';
  if (family === 'pixel' || family === 'galaxy') return 'Android phone';
  return device.id.startsWith('iphone-16-pro') ? 'titanium phone' : 'aluminum phone';
}
