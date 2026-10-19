/**
 * Device descriptors. The engine never asks "which phone is this?" — it reads
 * a descriptor: viewport, scale, safe areas, size classes, system bar
 * geometry. A new device is a new descriptor, not new code.
 *
 * Values are measured from real devices/simulators where known and are
 * otherwise approximate; the oracle loop (see docs/fidelity.md) is how they
 * get corrected.
 */
export type PlatformName = 'ios' | 'android';
export type Orientation = 'portrait' | 'landscape';
export type Appearance = 'light' | 'dark';
export type SizeClass = 'compact' | 'regular';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DeviceDescriptor {
  id: string;
  name: string;
  platform: PlatformName;
  idiom: 'phone' | 'tablet';
  /** logical size in portrait (points on iOS, dp on Android) */
  width: number;
  height: number;
  /** physical pixels per logical unit */
  scale: number;
  /** iOS version string, or Android API level as a string */
  osVersion: string;
  /** display corner radius in logical units (0 = square) */
  cornerRadius: number;
  safeArea: Record<Orientation, Insets>;
  statusBarHeight: Record<Orientation, number>;
  cutout: { kind: 'dynamic-island' | 'notch' | 'punch-hole' | 'none'; width: number; height: number; top: number };
  /** iOS home indicator / Android gesture handle */
  homeIndicator: boolean;
  sizeClass: Record<Orientation, { horizontal: SizeClass; vertical: SizeClass }>;
  /** marks descriptors whose metrics have not been checked against the oracle */
  approximate?: boolean;
}

const insets = (top: number, right: number, bottom: number, left: number): Insets => ({ top, right, bottom, left });
const phoneClasses = {
  portrait: { horizontal: 'compact', vertical: 'regular' },
  landscape: { horizontal: 'compact', vertical: 'compact' },
} as const;
const maxPhoneClasses = {
  portrait: { horizontal: 'compact', vertical: 'regular' },
  landscape: { horizontal: 'regular', vertical: 'compact' },
} as const;
const tabletClasses = {
  portrait: { horizontal: 'regular', vertical: 'regular' },
  landscape: { horizontal: 'regular', vertical: 'regular' },
} as const;

/**
 * 2026 device profiles. Physical pixel dimensions come from the manufacturer;
 * logical viewports, cutout and safe-area metrics marked approximate still
 * require oracle captures. Device identity stays separate from OS rendering.
 */
const dynamicIsland = (width = 125, height = 37, top = 14) =>
  ({ kind: 'dynamic-island' as const, width, height, top });
const punchHole = (size = 20, top = 12) =>
  ({ kind: 'punch-hole' as const, width: size, height: size, top });

function iphone(id: string, name: string, width: number, height: number, proMax = false, island = dynamicIsland()): DeviceDescriptor {
  return {
    id, name, platform: 'ios', idiom: 'phone', width, height, scale: 3,
    osVersion: '27.0', cornerRadius: 62,
    safeArea: { portrait: insets(62, 0, 34, 0), landscape: insets(0, 62, 21, 62) },
    statusBarHeight: { portrait: 54, landscape: 0 }, cutout: island,
    homeIndicator: true, sizeClass: proMax ? maxPhoneClasses : phoneClasses,
    approximate: true,
  };
}

function ipad(id: string, name: string, width: number, height: number): DeviceDescriptor {
  return {
    id, name, platform: 'ios', idiom: 'tablet', width, height, scale: 2,
    osVersion: '27.0', cornerRadius: 18,
    safeArea: { portrait: insets(24, 0, 20, 0), landscape: insets(24, 0, 20, 0) },
    statusBarHeight: { portrait: 24, landscape: 24 },
    cutout: { kind: 'none', width: 0, height: 0, top: 0 },
    homeIndicator: true, sizeClass: tabletClasses, approximate: true,
  };
}

function androidPhone(id: string, name: string, width: number, height: number, scale: number): DeviceDescriptor {
  return {
    id, name, platform: 'android', idiom: 'phone', width, height, scale,
    osVersion: '37', cornerRadius: 48,
    safeArea: { portrait: insets(48, 0, 24, 0), landscape: insets(0, 48, 24, 0) },
    statusBarHeight: { portrait: 48, landscape: 24 }, cutout: punchHole(),
    homeIndicator: true, sizeClass: phoneClasses, approximate: true,
  };
}

export const DEVICES: readonly DeviceDescriptor[] = [
  // iPhone 18 Pro is the announced 2026 lineup; do not invent an unannounced base iPhone 18.
  iphone('iphone-18-pro', 'iPhone 18 Pro', 402, 874, false, dynamicIsland(112, 34, 14)),
  iphone('iphone-18-pro-max', 'iPhone 18 Pro Max', 440, 956, true, dynamicIsland(112, 34, 14)),
  iphone('iphone-17', 'iPhone 17', 402, 874),
  iphone('iphone-16-pro', 'iPhone 16 Pro', 402, 874),
  iphone('iphone-16-pro-max', 'iPhone 16 Pro Max', 440, 956, true),
  iphone('iphone-16', 'iPhone 16', 393, 852),
  iphone('iphone-16-plus', 'iPhone 16 Plus', 430, 932, true),
  ipad('ipad-pro-11-m5', 'iPad Pro 11" (M5)', 834, 1210),
  ipad('ipad-pro-13-m5', 'iPad Pro 13" (M5)', 1032, 1376),
  ipad('ipad-air-11-m4', 'iPad Air 11" (M4)', 820, 1180),
  ipad('ipad-air-13-m4', 'iPad Air 13" (M4)', 1032, 1376),
  androidPhone('pixel-11-pro', 'Pixel 11 Pro', 412, 919, 3.11),
  androidPhone('pixel-11-pro-xl', 'Pixel 11 Pro XL', 430, 958, 3.13),
  androidPhone('galaxy-s26', 'Galaxy S26', 384, 854, 3),
  androidPhone('galaxy-s26-ultra', 'Galaxy S26 Ultra', 412, 892, 3.5),
  {
    id: 'iphone-17-pro', name: 'iPhone 17 Pro', platform: 'ios', idiom: 'phone',
    width: 402, height: 874, scale: 3, osVersion: '27.0', cornerRadius: 62,
    safeArea: { portrait: insets(62, 0, 34, 0), landscape: insets(0, 62, 21, 62) },
    statusBarHeight: { portrait: 54, landscape: 0 },
    cutout: { kind: 'dynamic-island', width: 125, height: 37, top: 14 },
    homeIndicator: true, sizeClass: phoneClasses,
  },
  {
    id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', platform: 'ios', idiom: 'phone',
    width: 440, height: 956, scale: 3, osVersion: '27.0', cornerRadius: 62,
    safeArea: { portrait: insets(62, 0, 34, 0), landscape: insets(0, 62, 21, 62) },
    statusBarHeight: { portrait: 54, landscape: 0 },
    cutout: { kind: 'dynamic-island', width: 125, height: 37, top: 14 },
    homeIndicator: true, sizeClass: maxPhoneClasses,
  },
  {
    id: 'iphone-16e', name: 'iPhone 16e', platform: 'ios', idiom: 'phone',
    width: 390, height: 844, scale: 3, osVersion: '27.0', cornerRadius: 47,
    safeArea: { portrait: insets(47, 0, 34, 0), landscape: insets(0, 47, 21, 47) },
    statusBarHeight: { portrait: 47, landscape: 0 },
    cutout: { kind: 'notch', width: 162, height: 34, top: 0 },
    homeIndicator: true, sizeClass: phoneClasses, approximate: true,
  },
  {
    id: 'iphone-se', name: 'iPhone SE', platform: 'ios', idiom: 'phone',
    width: 375, height: 667, scale: 2, osVersion: '27.0', cornerRadius: 0,
    safeArea: { portrait: insets(20, 0, 0, 0), landscape: insets(0, 0, 0, 0) },
    statusBarHeight: { portrait: 20, landscape: 0 },
    cutout: { kind: 'none', width: 0, height: 0, top: 0 },
    homeIndicator: false, sizeClass: phoneClasses,
  },
  {
    id: 'ipad-air-11', name: 'iPad Air 11"', platform: 'ios', idiom: 'tablet',
    width: 820, height: 1180, scale: 2, osVersion: '27.0', cornerRadius: 18,
    safeArea: { portrait: insets(24, 0, 20, 0), landscape: insets(24, 0, 20, 0) },
    statusBarHeight: { portrait: 24, landscape: 24 },
    cutout: { kind: 'none', width: 0, height: 0, top: 0 },
    homeIndicator: true, sizeClass: tabletClasses,
  },
  {
    id: 'pixel-9', name: 'Pixel 9', platform: 'android', idiom: 'phone',
    width: 411, height: 923, scale: 2.625, osVersion: '36', cornerRadius: 48,
    safeArea: { portrait: insets(48, 0, 24, 0), landscape: insets(0, 48, 24, 0) },
    statusBarHeight: { portrait: 48, landscape: 24 },
    cutout: { kind: 'punch-hole', width: 22, height: 22, top: 14 },
    homeIndicator: true, sizeClass: phoneClasses, approximate: true,
  },
  {
    id: 'galaxy-s25', name: 'Galaxy S25', platform: 'android', idiom: 'phone',
    width: 360, height: 780, scale: 3, osVersion: '35', cornerRadius: 40,
    safeArea: { portrait: insets(40, 0, 24, 0), landscape: insets(0, 40, 24, 0) },
    statusBarHeight: { portrait: 40, landscape: 24 },
    cutout: { kind: 'punch-hole', width: 18, height: 18, top: 12 },
    homeIndicator: true, sizeClass: phoneClasses, approximate: true,
  },
  {
    id: 'pixel-tablet', name: 'Pixel Tablet', platform: 'android', idiom: 'tablet',
    width: 800, height: 1280, scale: 2, osVersion: '36', cornerRadius: 24,
    safeArea: { portrait: insets(32, 0, 24, 0), landscape: insets(32, 0, 24, 0) },
    statusBarHeight: { portrait: 32, landscape: 32 },
    cutout: { kind: 'none', width: 0, height: 0, top: 0 },
    homeIndicator: true, sizeClass: tabletClasses, approximate: true,
  },
];

export function getDevice(id: string): DeviceDescriptor {
  const device = DEVICES.find((d) => d.id === id);
  if (!device) throw new Error(`Unknown device "${id}". Known: ${DEVICES.map((d) => d.id).join(', ')}`);
  return device;
}

export const defaultDevice = (platform: PlatformName): DeviceDescriptor =>
  DEVICES.find((d) => d.platform === platform)!;

/** The device as the app sees it right now. */
export interface Viewport {
  device: DeviceDescriptor;
  orientation: Orientation;
  width: number;
  height: number;
  scale: number;
  safeArea: Insets;
  statusBarHeight: number;
  sizeClass: { horizontal: SizeClass; vertical: SizeClass };
  fontScale: number;
}

export function resolveViewport(device: DeviceDescriptor, orientation: Orientation = 'portrait', fontScale = 1): Viewport {
  const landscape = orientation === 'landscape';
  return {
    device,
    orientation,
    width: landscape ? device.height : device.width,
    height: landscape ? device.width : device.height,
    scale: device.scale,
    safeArea: device.safeArea[orientation],
    statusBarHeight: device.statusBarHeight[orientation],
    sizeClass: device.sizeClass[orientation],
    fontScale,
  };
}
