import { describe, expect, it } from 'vitest';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, AppCompatDelegate, Color, ColorDrawable, Configuration, FrameLayout, FrameLayoutParams, GradientDrawable, Gravity, LayoutParams,
  LinearLayout, LinearLayoutParams, MaterialColors, View, ViewOutlineProvider, type Context,
} from '@mimicry/os-android';
import { PNG } from 'pngjs';

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

const sized = (context: Context, w: number, h: number) => {
  const v = new View(context);
  v.setLayoutParams(new LinearLayoutParams(w, h));
  return v;
};

function pixel(device: Device, x: number, y: number): number[] {
  const png = PNG.sync.read(device.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe('LinearLayout', () => {
  it('stacks children with margins and shares the rest by weight', () => {
    let a!: View, b!: View, c!: View, root!: LinearLayout;
    launch((ctx) => {
      root = new LinearLayout(ctx);
      root.setOrientation(LinearLayout.VERTICAL);
      root.setPadding(10, 20, 10, 0);
      a = sized(ctx, LayoutParams.MATCH_PARENT, 100);
      (a.getLayoutParams() as LinearLayoutParams).setMargins(4, 6, 4, 6);
      b = sized(ctx, LayoutParams.MATCH_PARENT, 0);
      (b.getLayoutParams() as LinearLayoutParams).weight = 1;
      c = sized(ctx, LayoutParams.MATCH_PARENT, 0);
      (c.getLayoutParams() as LinearLayoutParams).weight = 3;
      root.addView(a);
      root.addView(b);
      root.addView(c);
      return root;
    });
    expect([a.getLeft(), a.getTop(), a.getWidth(), a.getHeight()]).toEqual([14, 26, 383, 100]);
    const rest = root.getHeight() - 20 - 112;
    expect(b.getTop()).toBe(132);
    expect(b.getHeight()).toBeCloseTo(rest / 4);
    expect(c.getHeight()).toBeCloseTo((rest * 3) / 4);
    expect(c.getBottom()).toBeCloseTo(root.getHeight());
  });

  it('centers content with gravity and aligns children across the axis', () => {
    let row!: LinearLayout, x!: View, y!: View;
    launch((ctx) => {
      const frame = new FrameLayout(ctx);
      row = new LinearLayout(ctx);
      row.setGravity(Gravity.CENTER);
      x = sized(ctx, 50, 20);
      y = sized(ctx, 30, 40);
      (y.getLayoutParams() as LinearLayoutParams).gravity = Gravity.BOTTOM;
      row.addView(x);
      row.addView(y);
      frame.addView(row, -1, new FrameLayoutParams(300, 100));
      return frame;
    });
    expect(x.getLeft()).toBe(110);
    expect(x.getTop()).toBe(40);
    expect(y.getLeft()).toBe(160);
    expect(y.getTop()).toBe(60);
  });

  it('wraps its content and makes MATCH_PARENT children uniform', () => {
    let col!: LinearLayout, wide!: View, fill!: View;
    launch((ctx) => {
      const frame = new FrameLayout(ctx);
      col = new LinearLayout(ctx);
      col.setOrientation(LinearLayout.VERTICAL);
      wide = sized(ctx, 120, 10);
      fill = sized(ctx, LayoutParams.MATCH_PARENT, 10);
      col.addView(wide);
      col.addView(fill);
      frame.addView(col, -1, new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
      return frame;
    });
    expect(col.getWidth()).toBe(120);
    expect(col.getHeight()).toBe(20);
    expect(fill.getWidth()).toBe(120);
  });
});

describe('FrameLayout', () => {
  it('places children by layout_gravity and margins', () => {
    let br!: View, center!: View;
    launch((ctx) => {
      const frame = new FrameLayout(ctx);
      br = new View(ctx);
      const lp = new FrameLayoutParams(40, 40, Gravity.BOTTOM | Gravity.END);
      lp.setMargins(0, 0, 16, 16);
      frame.addView(br, -1, lp);
      center = new View(ctx);
      frame.addView(center, -1, new FrameLayoutParams(100, 50, Gravity.CENTER));
      return frame;
    });
    expect(br.getRight()).toBe(411 - 16);
    expect(br.getBottom()).toBe(923 - 16);
    expect(center.getLeft()).toBeCloseTo((411 - 100) / 2);
    expect(center.getTop()).toBeCloseTo((923 - 50) / 2);
  });

  it('gives addView children MATCH_PARENT by default', () => {
    let child!: View;
    launch((ctx) => {
      const frame = new FrameLayout(ctx);
      child = new View(ctx);
      frame.addView(child);
      return frame;
    });
    expect([child.getWidth(), child.getHeight()]).toEqual([411, 923]);
  });
});

describe('outlines and elevation', () => {
  it('casts a shadow below an elevated view with an opaque background', () => {
    let card!: View;
    const { device } = launch((ctx) => {
      const frame = new FrameLayout(ctx);
      frame.setBackgroundColor(Color.WHITE);
      card = new View(ctx);
      const bg = new GradientDrawable();
      bg.setColor(Color.WHITE);
      bg.setCornerRadius(12);
      card.setBackground(bg);
      frame.addView(card, -1, new FrameLayoutParams(200, 100, Gravity.CENTER));
      return frame;
    });
    const below = () => pixel(device, 205, (923 + 100) / 2 + 4);
    expect(below()).toEqual([255, 255, 255]);
    card.setElevation(8);
    device.advance(17);
    const shadow = below();
    expect(shadow[0]!).toBeLessThan(250);
    // a transparent background casts nothing
    card.setBackground(new ColorDrawable(Color.TRANSPARENT));
    device.advance(17);
    expect(below()).toEqual([255, 255, 255]);
  });

  it('clips children to the rounded outline', () => {
    let card!: FrameLayout;
    const { device } = launch((ctx) => {
      const frame = new FrameLayout(ctx);
      frame.setBackgroundColor(Color.WHITE);
      card = new FrameLayout(ctx);
      const bg = new GradientDrawable();
      bg.setColor(Color.WHITE);
      bg.setCornerRadius(40);
      card.setBackground(bg);
      card.setClipToOutline(true);
      const fill = new View(ctx);
      fill.setBackgroundColor(Color.BLACK);
      card.addView(fill);
      frame.addView(card, -1, new FrameLayoutParams(200, 200, Gravity.TOP | Gravity.START));
      return frame;
    });
    expect(card.getOutlineProvider()).toBe(ViewOutlineProvider.BACKGROUND);
    expect(pixel(device, 2, 2)).toEqual([255, 255, 255]);
    expect(pixel(device, 100, 100)).toEqual([0, 0, 0]);
  });
});

describe('Material 3 theme', () => {
  it('resolves color roles, framework attributes and night mode', () => {
    const { device, activity } = launch((ctx) => new View(ctx));
    const theme = activity.getTheme();
    expect(theme.getColor('?attr/colorPrimary')).toBe(Color.parseColor('#6750A4'));
    expect(theme.getColor('?android:attr/textColorPrimary')).toBe(Color.parseColor('#1D1B20'));
    expect(activity.getColor('@android:color/white')).toBe(Color.WHITE);
    expect(Color.alpha(theme.getColor('colorControlHighlight'))).toBe(26);
    expect(activity.getResources().getConfiguration().isNightModeActive()).toBe(false);
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES, device.kernel);
    expect(theme.getColor('colorPrimary')).toBe(Color.parseColor('#D0BCFF'));
    expect(activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK).toBe(Configuration.UI_MODE_NIGHT_YES);
    activity.setTheme({ colorPrimary: [Color.RED, Color.BLUE] });
    expect(MaterialColors.getColor(activity, 'colorPrimary')).toBe(Color.BLUE);
    expect(MaterialColors.isColorLight(Color.WHITE)).toBe(true);
  });
});
