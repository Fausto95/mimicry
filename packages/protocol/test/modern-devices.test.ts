import { describe, expect, it } from 'vitest';
import { DEVICES, defaultDevice, getDevice, resolveViewport } from '../src/devices';

describe('2026 device catalog', () => {
  it('has unique IDs and valid logical viewports', () => {
    expect(new Set(DEVICES.map((d) => d.id)).size).toBe(DEVICES.length);
    for (const d of DEVICES) {
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(d.width);
      expect(d.scale).toBeGreaterThan(0);
      expect(d.safeArea.portrait.top).toBeGreaterThanOrEqual(0);
      expect(d.safeArea.portrait.bottom).toBeGreaterThanOrEqual(0);
      expect(d.safeArea.portrait.top + d.safeArea.portrait.bottom).toBeLessThan(d.height);
      expect(d.cutout.width).toBeLessThanOrEqual(d.width);
    }
  });

  it('includes the latest iPhones, earlier generations and M-series iPads', () => {
    for (const id of [
      'iphone-18-pro', 'iphone-18-pro-max', 'iphone-17-pro', 'iphone-17',
      'iphone-16-pro', 'iphone-16-pro-max', 'iphone-16', 'iphone-16-plus',
      'ipad-pro-11-m5', 'ipad-pro-13-m5', 'ipad-air-11-m4', 'ipad-air-13-m4',
    ]) {
      expect(getDevice(id).platform).toBe('ios');
      expect(getDevice(id).osVersion).toBe('27.0');
    }
  });

  it('advertises Android 17 as API level 37 on the newest phones', () => {
    for (const id of ['pixel-11-pro', 'pixel-11-pro-xl', 'galaxy-s26', 'galaxy-s26-ultra']) {
      expect(getDevice(id).osVersion).toBe('37');
      expect(getDevice(id).cutout.kind).toBe('punch-hole');
    }
  });

  it('uses current device families by default', () => {
    expect(defaultDevice('ios').id).toBe('iphone-18-pro');
    expect(defaultDevice('android').id).toBe('pixel-11-pro');
  });

  it('resolves 18 Pro Max and iPad viewports in both orientations', () => {
    const phone = getDevice('iphone-18-pro-max');
    expect(resolveViewport(phone).width).toBe(440);
    expect(resolveViewport(phone).height).toBe(956);
    expect(resolveViewport(phone, 'landscape').width).toBe(956);
    expect(resolveViewport(phone, 'landscape').sizeClass.horizontal).toBe('regular');
    const tablet = getDevice('ipad-pro-13-m5');
    expect(resolveViewport(tablet, 'landscape').width).toBe(1376);
    expect(resolveViewport(tablet, 'landscape').sizeClass.horizontal).toBe('regular');
  });
});
