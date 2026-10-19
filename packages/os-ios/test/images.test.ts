import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  CGRectMake, UIColor, UIImage, UIImageRenderingMode, UIImageSymbolConfiguration, UIImageSymbolScale, UIImageView, UIView,
  UIViewContentMode, materialNameFor,
} from '@mimicry/os-ios';
import { boot, decode, pixel, pixelAt, saveArtifact } from './helpers';

/** A w×h PNG data URI: left half red, right half blue, opaque. */
function twoTone(w: number, h: number): string {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      png.data[i] = left ? 255 : 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = left ? 0 : 255;
      png.data[i + 3] = 255;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

describe('UIImage', () => {
  it('finds catalog assets by name with their size at once', () => {
    boot();
    UIImage.registerAsset('logo', { uri: twoTone(60, 30), width: 60, height: 30, scale: 3 });
    const image = UIImage.named('logo')!;
    expect(image.size).toEqual({ width: 20, height: 10 });
    expect(image.scale).toBe(3);
    expect(UIImage.named('missing')).toBeNull();
    expect(image.withRenderingMode(UIImageRenderingMode.alwaysTemplate).isTemplate).toBe(true);
  });

  it('loads files and data, learning the size when decoded', async () => {
    const { device } = boot();
    const image = UIImage.contentsOfFile(twoTone(40, 20));
    expect(image.size).toEqual({ width: 0, height: 0 });
    let loads = 0;
    image._observe(() => loads++);
    await device.ready();
    expect(image.size).toEqual({ width: 40, height: 20 });
    expect(loads).toBe(1);
    const bytes = Buffer.from(twoTone(8, 8).split(',')[1]!, 'base64');
    const fromData = UIImage.fromData(new Uint8Array(bytes), 2);
    await device.ready();
    expect(fromData.size).toEqual({ width: 4, height: 4 });
  });

  it('makes SF Symbols from the bundled glyph font', () => {
    boot();
    const star = UIImage.systemName('star.fill')!;
    expect(star.isSymbolImage).toBe(true);
    expect(star.size.width).toBeCloseTo(17 * 1.2, 0);
    const big = star.withConfiguration(UIImageSymbolConfiguration.fromPointSize(30, undefined, UIImageSymbolScale.large));
    expect(big.size.width).toBeCloseTo(30 * 1.3 * 1.2, 0);
    expect(materialNameFor('gearshape.fill')).toBe('settings');
    expect(materialNameFor('cloud.rain')).toBe('cloud_rain');
  });
});

describe('UIImageView', () => {
  it('sizes to its image and redraws when it loads', async () => {
    const { device, root } = boot();
    const view = new UIImageView(UIImage.contentsOfFile(twoTone(100, 50)));
    root.view.addSubview(view);
    expect(view.intrinsicContentSize).toEqual({ width: 0, height: 0 });
    await device.ready();
    expect(view.intrinsicContentSize).toEqual({ width: 100, height: 50 });
    view.frame = CGRectMake(20, 100, 100, 50);
    device.advance(17);
    expect(pixel(device, 40, 125)).toEqual([255, 0, 0]);
    expect(pixel(device, 100, 125)).toEqual([0, 0, 255]);
  });

  it('places the image for every content mode', async () => {
    const { device, root } = boot();
    const image = UIImage.contentsOfFile(twoTone(40, 20));
    await device.ready();
    const view = new UIImageView(CGRectMake(0, 0, 100, 100));
    view.image = image;
    root.view.addSubview(view);
    const rect = (mode: UIViewContentMode) => {
      view.contentMode = mode;
      const r = view.imageRect(image);
      return [r.origin.x, r.origin.y, r.size.width, r.size.height];
    };
    expect(rect(UIViewContentMode.scaleToFill)).toEqual([0, 0, 100, 100]);
    expect(rect(UIViewContentMode.scaleAspectFit)).toEqual([0, 25, 100, 50]);
    expect(rect(UIViewContentMode.scaleAspectFill)).toEqual([-50, 0, 200, 100]);
    expect(rect(UIViewContentMode.center)).toEqual([30, 40, 40, 20]);
    expect(rect(UIViewContentMode.top)).toEqual([30, 0, 40, 20]);
    expect(rect(UIViewContentMode.bottomRight)).toEqual([60, 80, 40, 20]);
    expect(rect(UIViewContentMode.left)).toEqual([0, 40, 40, 20]);
  });

  it('clips aspect fill only with clipsToBounds', async () => {
    const { device, root } = boot();
    const image = UIImage.contentsOfFile(twoTone(40, 20));
    await device.ready();
    const view = new UIImageView(CGRectMake(150, 200, 100, 100));
    view.image = image;
    view.contentMode = UIViewContentMode.scaleAspectFill;
    root.view.addSubview(view);
    device.advance(17);
    expect(pixel(device, 120, 250)).toEqual([255, 0, 0]); // overflows to the left
    view.clipsToBounds = true;
    device.advance(17);
    expect(pixel(device, 120, 250)).toEqual([255, 255, 255]);
    expect(pixel(device, 160, 250)).toEqual([255, 0, 0]);
  });

  it('tints templates and symbols', async () => {
    const { device, root } = boot();
    const image = UIImage.contentsOfFile(twoTone(40, 20)).withRenderingMode(UIImageRenderingMode.alwaysTemplate);
    await device.ready();
    const view = new UIImageView(CGRectMake(20, 100, 40, 20));
    view.image = image;
    view.tintColor = UIColor.systemGreen;
    root.view.addSubview(view);
    device.advance(17);
    expect(pixel(device, 30, 110)).toEqual([52, 199, 89]);
    expect(pixel(device, 50, 110)).toEqual([52, 199, 89]);
    const symbol = new UIImageView(CGRectMake(100, 100, 60, 60));
    symbol.image = UIImage.systemName('heart.fill', UIImageSymbolConfiguration.fromPointSize(40));
    symbol.contentMode = UIViewContentMode.center;
    root.view.addSubview(symbol);
    device.advance(17);
    const img = decode(device.screenshot());
    let blue = 0;
    for (let y = 100 * 3; y < 160 * 3; y += 2) for (let x = 100 * 3; x < 160 * 3; x += 2) {
      const [r, g, b] = pixelAt(img, x, y);
      if (b > 200 && r < 60 && g < 160) blue++;
    }
    expect(blue).toBeGreaterThan(200); // the glyph, in the default tint (systemBlue)
  });

  it('cycles animation images', async () => {
    const { device, root } = boot();
    const red = UIImage.named('nothing') ?? UIImage.contentsOfFile(twoTone(2, 2));
    void red;
    const solid = (r: number, g: number, b: number) => {
      const png = new PNG({ width: 2, height: 2 });
      for (let i = 0; i < 16; i += 4) png.data.set([r, g, b, 255], i);
      return UIImage.contentsOfFile(`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`);
    };
    const frames = [solid(255, 0, 0), solid(0, 255, 0), solid(0, 0, 255)];
    await device.ready();
    const view = new UIImageView(CGRectMake(20, 100, 50, 50));
    view.animationImages = frames;
    view.animationDuration = 0.3;
    view.animationRepeatCount = 1;
    root.view.addSubview(view);
    view.startAnimating();
    device.advance(50);
    expect(pixel(device, 45, 125)).toEqual([255, 0, 0]);
    device.advance(100);
    expect(pixel(device, 45, 125)).toEqual([0, 255, 0]);
    device.advance(300);
    expect(view.isAnimating).toBe(false);
  });

  it('renders a gallery of symbols', () => {
    const { device, root } = boot();
    const names = ['house.fill', 'magnifyingglass', 'heart.fill', 'gearshape', 'person.crop.circle', 'bell', 'star.fill', 'trash',
      'square.and.arrow.up', 'paperplane.fill', 'checkmark.circle.fill', 'xmark', 'plus', 'chevron.right', 'ellipsis', 'camera.fill'];
    names.forEach((name, i) => {
      const cell = new UIView(CGRectMake(20 + (i % 4) * 90, 100 + Math.floor(i / 4) * 90, 80, 80));
      cell.backgroundColor = UIColor.secondarySystemBackground;
      cell.layer.cornerRadius = 16;
      const v = new UIImageView(CGRectMake(20, 20, 40, 40));
      v.image = UIImage.systemName(name, UIImageSymbolConfiguration.fromPointSize(26));
      v.contentMode = UIViewContentMode.center;
      if (i % 3 === 1) v.tintColor = UIColor.systemOrange;
      cell.addSubview(v);
      root.view.addSubview(cell);
    });
    saveArtifact('symbols.png', device.advance(17).screenshot());
  });
});
