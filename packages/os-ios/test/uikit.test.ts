import { describe, expect, it } from 'vitest';
import { createDevice } from '@mimicry/testing';
import { CGRectMake, UIColor, UIScrollView, UISwitch, UIView, UIViewController } from '@mimicry/os-ios';
import { PNG } from 'pngjs';

const pixel = (png: Buffer, x: number, y: number) => {
  const img = PNG.sync.read(png);
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

describe('UIKit on the kernel', () => {
  it('draws a view hierarchy in a window', () => {
    const device = createDevice({ device: 'iphone-17-pro' });
    const app = device.ios.application;
    const window = app.makeWindow();
    const root = new UIViewController();
    root.view.backgroundColor = UIColor.white;
    const box = new UIView(CGRectMake(20, 100, 100, 50));
    box.backgroundColor = UIColor.systemRed;
    box.layer.cornerRadius = 8;
    root.view.addSubview(box);
    window.rootViewController = root;
    window.makeKeyAndVisible();
    device.advance(32);
    const png = device.screenshot(1);
    expect(pixel(png, 70, 125)).toEqual([255, 59, 48]);
    expect(pixel(png, 200, 300)).toEqual([255, 255, 255]);
  });

  it('delivers taps to a UISwitch and scrolls a UIScrollView', () => {
    const device = createDevice({ device: 'iphone-17-pro' });
    const window = device.ios.application.makeWindow();
    const vc = new UIViewController();
    window.rootViewController = vc;
    const scroll = new UIScrollView(CGRectMake(0, 0, 402, 874));
    scroll.contentSize = { width: 402, height: 3000 };
    scroll.contentInsetAdjustmentBehavior = 2; // never
    vc.view.addSubview(scroll);
    const toggle = new UISwitch(CGRectMake(20, 200, 63, 28));
    let changes = 0;
    toggle.addTarget(() => changes++, 1 << 12);
    scroll.addSubview(toggle);
    window.makeKeyAndVisible();
    device.advance(16);
    device.tap(40, 214);
    device.settle();
    expect(toggle.isOn).toBe(true);
    expect(changes).toBe(1);
    device.drag(200, 600, 0, -300);
    device.settle();
    expect(scroll.contentOffset.y).toBeGreaterThan(250);
  });
});
