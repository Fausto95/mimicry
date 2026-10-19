import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, Bitmap, BitmapFactory, Color, ColorStateList, FrameLayout, FrameLayoutParams, Gravity, ImageView, LayoutParams, MaterialIconDrawable,
  MaterialIconPaths, Matrix, RectF, ScaleToFit, ScaleType, VectorDrawable, type View,
} from '@mimicry/os-android';

/** A 200 × 100 px PNG: left half red, right half blue. */
function twoTone(): Buffer {
  const png = new PNG({ width: 200, height: 100 });
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 4;
      png.data[i] = x < 100 ? 255 : 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = x < 100 ? 0 : 255;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const DENSITY = 2.625;

function launch(build: (activity: Activity) => View): { device: Device; activity: Activity } {
  const device = createDevice({ device: 'pixel-9' });
  let activity!: Activity;
  class Main extends Activity {
    protected override onCreate(): void {
      activity = this;
      this.setContentView(build(this));
    }
  }
  new Main(device.kernel, device.android.windowManager).launch();
  device.advance(32);
  return { device, activity };
}

function imageScreen(lp: FrameLayoutParams, configure: (iv: ImageView) => void) {
  let iv!: ImageView;
  const launched = launch((ctx) => {
    const frame = new FrameLayout(ctx);
    frame.setBackgroundColor(Color.WHITE);
    iv = new ImageView(ctx);
    configure(iv);
    frame.addView(iv, -1, lp);
    return frame;
  });
  return { ...launched, iv };
}

function rgb(device: Device, x: number, y: number): number[] {
  const png = PNG.sync.read(device.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

const near = (a: number[], b: number[], tolerance = 24) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

describe('Bitmap and BitmapFactory', () => {
  it('decodes bytes asynchronously and reports the size in pixels and dp', async () => {
    const { device } = launch((ctx) => new FrameLayout(ctx));
    const opts = new BitmapFactory.Options();
    const bitmap = BitmapFactory.decodeByteArray(twoTone(), 0, undefined, opts);
    expect(bitmap.getWidth()).toBe(0);
    let loaded = 0;
    bitmap.addOnLoadedListener(() => loaded++);
    await device.ready();
    expect(loaded).toBe(1);
    expect([bitmap.getWidth(), bitmap.getHeight()]).toEqual([200, 100]);
    expect([opts.outWidth, opts.outHeight, opts.outMimeType]).toEqual([200, 100, 'image/png']);
    expect(bitmap.sizeInDp().width).toBeCloseTo(200 / DENSITY);
    const blank = Bitmap.createBitmap(10, 20);
    expect([blank.getWidth(), blank.getHeight()]).toEqual([10, 20]);
  });
});

describe('Matrix', () => {
  it('composes pre and post operations and maps rects onto rects', () => {
    const m = new Matrix();
    m.setScale(2, 3);
    m.postTranslate(10, 20);
    const pts = [1, 1];
    m.mapPoints(pts);
    expect(pts).toEqual([12, 23]);
    m.preTranslate(1, 0);
    const p2 = [0, 0];
    m.mapPoints(p2);
    expect(p2).toEqual([12, 20]);
    const fit = new Matrix();
    fit.setRectToRect(new RectF(0, 0, 200, 100), new RectF(0, 0, 100, 100), ScaleToFit.CENTER);
    const r = new RectF(0, 0, 200, 100);
    fit.mapRect(r);
    expect([r.left, r.top, r.right, r.bottom]).toEqual([0, 25, 100, 75]);
    expect(fit.getValues()).toEqual([0.5, 0, 0, 0, 0.5, 25, 0, 0, 1]);
    const inv = new Matrix();
    expect(fit.invert(inv)).toBe(true);
    const back = [0, 25];
    inv.mapPoints(back);
    expect(back).toEqual([0, 0]);
    const rot = new Matrix();
    rot.setRotate(90, 10, 10);
    const q = [20, 10];
    rot.mapPoints(q);
    expect(q[0]).toBeCloseTo(10);
    expect(q[1]).toBeCloseTo(20);
  });
});

describe('ImageView', () => {
  it('wraps its bitmap at device density and grows when it decodes', async () => {
    const bytes = twoTone();
    const { device, iv } = imageScreen(new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT), (v) => v.setImageBitmap(BitmapFactory.decodeByteArray(bytes)));
    // nothing decoded yet: the framework measures a 1 × 1 drawable
    expect(iv.getWidth()).toBe(1);
    await device.ready();
    device.advance(17);
    expect(iv.getWidth()).toBeCloseTo(200 / DENSITY);
    expect(iv.getHeight()).toBeCloseTo(100 / DENSITY);
  });

  it('crops to fill with CENTER_CROP and stays inside its bounds', async () => {
    const bytes = twoTone();
    const { device } = imageScreen(new FrameLayoutParams(100, 100, Gravity.CENTER), (v) => {
      v.setScaleType(ScaleType.CENTER_CROP);
      v.setImageBitmap(BitmapFactory.decodeByteArray(bytes));
    });
    await device.ready();
    device.advance(17);
    const cx = 411 / 2;
    const cy = 923 / 2;
    expect(near(rgb(device, cx - 30, cy), [255, 0, 0])).toBe(true);
    expect(near(rgb(device, cx + 30, cy), [0, 0, 255])).toBe(true);
    expect(near(rgb(device, cx - 30, cy - 45), [255, 0, 0])).toBe(true);
    // nothing spills out to the left or right of the 100dp box
    expect(rgb(device, cx - 60, cy)).toEqual([255, 255, 255]);
    expect(rgb(device, cx + 60, cy)).toEqual([255, 255, 255]);
  });

  it('letterboxes with FIT_CENTER and stretches with FIT_XY', async () => {
    const bytes = twoTone();
    const { device, iv } = imageScreen(new FrameLayoutParams(100, 100, Gravity.CENTER), (v) => v.setImageBitmap(BitmapFactory.decodeByteArray(bytes)));
    await device.ready();
    device.advance(17);
    const cx = 411 / 2;
    const cy = 923 / 2;
    expect(rgb(device, cx, cy - 40)).toEqual([255, 255, 255]);
    expect(near(rgb(device, cx - 20, cy), [255, 0, 0])).toBe(true);
    expect(iv.getImageMatrix().getValues()[4]).toBeCloseTo(100 / (200 / DENSITY));
    iv.setScaleType(ScaleType.FIT_XY);
    device.advance(17);
    expect(near(rgb(device, cx - 20, cy - 40), [255, 0, 0])).toBe(true);
  });

  it('keeps the aspect ratio with adjustViewBounds', async () => {
    const bytes = twoTone();
    const { device, iv } = imageScreen(new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT), (v) => {
      v.setAdjustViewBounds(true);
      v.setImageBitmap(BitmapFactory.decodeByteArray(bytes));
    });
    await device.ready();
    device.advance(17);
    expect(iv.getWidth()).toBe(411);
    expect(iv.getHeight()).toBeCloseTo(205.5, 0);
  });

  it('tints with a color filter or a tint list', async () => {
    const bytes = twoTone();
    const { device, iv } = imageScreen(new FrameLayoutParams(100, 100, Gravity.CENTER), (v) => {
      v.setScaleType(ScaleType.FIT_XY);
      v.setImageBitmap(BitmapFactory.decodeByteArray(bytes));
      v.setColorFilter(Color.GREEN);
    });
    await device.ready();
    device.advance(17);
    const cx = 411 / 2;
    const cy = 923 / 2;
    expect(near(rgb(device, cx - 30, cy), [0, 255, 0])).toBe(true);
    expect(near(rgb(device, cx + 30, cy), [0, 255, 0])).toBe(true);
    iv.clearColorFilter();
    iv.setImageTintList(new ColorStateList([['state_selected'], []], [Color.BLACK, Color.YELLOW]));
    device.advance(17);
    expect(near(rgb(device, cx + 30, cy), [255, 255, 0])).toBe(true);
    iv.setSelected(true);
    device.advance(17);
    expect(near(rgb(device, cx + 30, cy), [0, 0, 0])).toBe(true);
  });
});

describe('icon drawables', () => {
  it('draws Material Symbols glyphs by name, tinted', () => {
    let iv!: ImageView;
    const { device } = launch((ctx) => {
      const frame = new FrameLayout(ctx);
      frame.setBackgroundColor(Color.WHITE);
      iv = new ImageView(ctx);
      iv.setImageResource('home');
      frame.addView(iv, -1, new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
      return frame;
    });
    expect(iv.getDrawable()).toBeInstanceOf(MaterialIconDrawable);
    expect(iv.getWidth()).toBe(24);
    const png = PNG.sync.read(device.screenshot(DENSITY));
    let ink = 0;
    const x0 = Math.round(iv.getLeft() * DENSITY);
    const y0 = Math.round(iv.getTop() * DENSITY);
    for (let y = y0; y < y0 + 63; y++) {
      for (let x = x0; x < x0 + 63; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i]! < 160) ink++;
      }
    }
    // an outlined house covers a good part of its box, not all of it
    expect(ink).toBeGreaterThan(200);
    expect(ink).toBeLessThan(63 * 63 * 0.7);
    // ink only inside the icon's box
    expect(rgb(device, iv.getLeft() - 3, iv.getTop() + 12)).toEqual([255, 255, 255]);
  });

  it('draws vector path data scaled to its bounds', () => {
    const { device } = launch((ctx) => {
      const frame = new FrameLayout(ctx);
      frame.setBackgroundColor(Color.WHITE);
      const iv = new ImageView(ctx);
      iv.setImageDrawable(new VectorDrawable(MaterialIconPaths.add, 24, 24, 48, 48, Color.RED));
      frame.addView(iv, -1, new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
      return frame;
    });
    // the center of a plus sign is filled
    expect(near(rgb(device, 411 / 2, 923 / 2), [255, 0, 0])).toBe(true);
    expect(rgb(device, 411 / 2 - 20, 923 / 2 - 20)).toEqual([255, 255, 255]);
  });
});
