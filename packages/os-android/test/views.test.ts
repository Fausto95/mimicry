import { describe, expect, it } from 'vitest';
import { createDevice } from '@mimicry/testing';
import { Activity, Color, FrameLayout, LayoutParams, ScrollView, SwitchCompat, View, type Context } from '@mimicry/os-android';
import { PNG } from 'pngjs';

const pixel = (png: Buffer, x: number, y: number) => {
  const img = PNG.sync.read(png);
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

/** A frame with fixed child positions (left/top margins as a tiny absolute layout). */
class Absolute extends FrameLayout {
  readonly frames = new Map<View, [number, number, number, number]>();
  place(child: View, x: number, y: number, w: number, h: number): void {
    this.frames.set(child, [x, y, w, h]);
    this.addView(child);
  }
  protected override onLayout(): void {
    for (const [child, [x, y, w, h]] of this.frames) child.layout(x, y, x + w, y + h);
  }
}

describe('the View system on the kernel', () => {
  it('lays out and draws an activity', () => {
    const device = createDevice({ device: 'pixel-9' });
    const android = device.android;
    class Main extends Activity {
      protected override onCreate(): void {
        const root = new Absolute(this);
        root.setBackgroundColor(Color.WHITE);
        const box = new View(this);
        box.setBackgroundColor(Color.parseColor('#6750A4'));
        root.place(box, 20, 120, 100, 50);
        this.setContentView(root);
      }
    }
    new Main(device.kernel, android.windowManager).launch();
    device.advance(32);
    const png = device.screenshot(1);
    expect(pixel(png, 70, 145)).toEqual([0x67, 0x50, 0xa4]);
    expect(pixel(png, 200, 400)).toEqual([255, 255, 255]);
  });

  it('toggles a switch and scrolls a ScrollView', () => {
    const device = createDevice({ device: 'pixel-9' });
    let toggle!: SwitchCompat;
    let scroll!: ScrollView;
    class Main extends Activity {
      protected override onCreate(): void {
        scroll = new ScrollView(this as Context);
        const content = new Absolute(this);
        content.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, 3000));
        toggle = new SwitchCompat(this);
        content.place(toggle, 20, 200, 52, 32);
        scroll.addView(content);
        this.setContentView(scroll);
      }
    }
    new Main(device.kernel, device.android.windowManager).launch();
    device.advance(32);
    device.tap(40, 216);
    device.settle();
    expect(toggle.isChecked()).toBe(true);
    device.drag(200, 600, 0, -300);
    device.settle();
    expect(scroll.getScrollY()).toBeGreaterThan(250);
  });
});
