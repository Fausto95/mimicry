import { describe, expect, it } from 'vitest';
import { getDevice } from '@mimicry/protocol';
import { finishFor, finishesFor, hardwareLabel, shellFamily } from '../src/shell';

describe('physical device presentation', () => {
  it('assigns a generation-specific palette to modern iPhones', () => {
    expect(shellFamily(getDevice('iphone-18-pro'))).toBe('iphone18');
    expect(shellFamily(getDevice('iphone-17-pro'))).toBe('iphone17');
    expect(shellFamily(getDevice('iphone-16-pro'))).toBe('iphone16');
    expect(finishesFor(getDevice('iphone-18-pro')).map((f) => f.name))
      .toContain('Burgundy');
    expect(finishesFor(getDevice('iphone-16-pro')).map((f) => f.name))
      .toContain('Black Titanium');
  });

  it('does not accept unsupported finishes when switching devices', () => {
    const iphone = getDevice('iphone-18-pro');
    expect(finishFor(iphone, 'silver').id).toBe('silver');
    expect(finishFor(iphone, 'unknown').id).toBe(finishesFor(iphone)[0]!.id);
    expect(finishFor(getDevice('pixel-11-pro'), 'burgundy').id).toBe('obsidian');
  });

  it('keeps hardware independent from logical simulator viewport', () => {
    expect(shellFamily(getDevice('ipad-pro-11-m5'))).toBe('ipad');
    expect(shellFamily(getDevice('galaxy-s26-ultra'))).toBe('galaxy');
    expect(hardwareLabel(getDevice('iphone-16-pro'))).toBe('titanium phone');
    expect(hardwareLabel(getDevice('pixel-11-pro'))).toBe('Android phone');
  });
});
