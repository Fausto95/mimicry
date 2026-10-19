import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, ButtonStyle, CheckBox, Chip, ChipGroup, ChipStyle, Color, ExtendedFloatingActionButton, FloatingActionButton, FrameLayout, FrameLayoutParams,
  Gravity, LayoutParams, LinearLayout, LinearLayoutParams, LinearProgressIndicator, MaterialButton, MaterialCardView, MaterialSwitch, RadioButton,
  RadioGroup, ScrollView, SeekBar, Slider, Snackbar, Toast, View, WindowType, type Context,
} from '@mimicry/os-android';

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

/** One view centered in a white frame. */
function single<T extends View>(make: (ctx: Context) => T, lp = new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER)) {
  let view!: T;
  const launched = launch((ctx) => {
    const frame = new FrameLayout(ctx);
    frame.setBackgroundColor(Color.WHITE);
    view = make(ctx);
    frame.addView(view, -1, lp);
    return frame;
  });
  return { ...launched, view };
}

function center(v: View): [number, number] {
  const [x, y] = v.getLocationInWindow();
  return [x + v.getWidth() / 2, y + v.getHeight() / 2];
}

function rgb(device: Device, x: number, y: number): number[] {
  const png = PNG.sync.read(device.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

const hex = (argb: number) => [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255];
const near = (a: number[], b: number[], tolerance = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

describe('MaterialButton', () => {
  it('is a 40 dp pill in a 48 dp touch target, filled with primary, and clicks', () => {
    let clicks = 0;
    const { device, view } = single((ctx) => {
      const b = new MaterialButton(ctx);
      b.setText('Save');
      b.setOnClickListener(() => clicks++);
      return b;
    });
    expect(view.getHeight()).toBe(48);
    expect(view.getWidth()).toBeGreaterThan(70);
    const [cx, cy] = center(view);
    expect(near(rgb(device, view.getLeft() + 6, cy), hex(Color.parseColor('#6750A4')))).toBe(true);
    // the inset strip above the container is not filled
    expect(rgb(device, cx, view.getTop() + 2)).toEqual([255, 255, 255]);
    device.tap(cx, cy);
    expect(clicks).toBe(1);
    view.setEnabled(false);
    device.tap(cx, cy);
    expect(clicks).toBe(1);
    device.advance(17);
    // disabled: onSurface at 12% over white
    expect(near(rgb(device, view.getLeft() + 6, cy), [227, 227, 228], 6)).toBe(true);
  });

  it('shows the state layer while pressed', () => {
    const { device, view } = single((ctx) => {
      const b = new MaterialButton(ctx, ButtonStyle.OUTLINED);
      b.setText('Press');
      return b;
    });
    const [cx, cy] = center(view);
    const before = rgb(device, cx + 20, cy - 10);
    device.pointer('down', cx, cy);
    device.advance(300);
    const pressed = rgb(device, cx + 20, cy - 10);
    expect(pressed[0]!).toBeLessThan(before[0]!);
    device.pointer('up', cx, cy);
    device.advance(500);
    expect(rgb(device, cx + 20, cy - 10)).toEqual(before);
  });

  it('makes icon buttons 48 dp and toggles checkable buttons', () => {
    const { device, view } = single((ctx) => {
      const b = new MaterialButton(ctx, ButtonStyle.ICON_OUTLINED);
      b.setIcon('favorite');
      b.setCheckable(true);
      return b;
    });
    expect([view.getWidth(), view.getHeight()]).toEqual([48, 48]);
    const seen: boolean[] = [];
    view.addOnCheckedChangeListener((_b, checked) => seen.push(checked));
    device.tap(...center(view));
    device.tap(...center(view));
    expect(seen).toEqual([true, false]);
  });
});

describe('selection controls', () => {
  it('check boxes toggle on tap and report it', () => {
    const { device, view } = single((ctx) => {
      const c = new CheckBox(ctx);
      c.setText('Remember me');
      return c;
    });
    expect(view.getHeight()).toBe(48);
    const changes: boolean[] = [];
    view.setOnCheckedChangeListener((_b, checked) => changes.push(checked));
    device.tap(view.getLeft() + 24, center(view)[1]);
    device.settle();
    expect(view.isChecked()).toBe(true);
    // the box is filled with primary
    expect(near(rgb(device, view.getLeft() + 18, center(view)[1] - 6), hex(Color.parseColor('#6750A4')), 30)).toBe(true);
    device.tap(view.getLeft() + 100, center(view)[1]);
    expect(changes).toEqual([true, false]);
    view.setCheckedState(CheckBox.STATE_INDETERMINATE);
    expect(view.getCheckedState()).toBe(CheckBox.STATE_INDETERMINATE);
  });

  it('a radio group keeps one button checked', () => {
    let a!: RadioButton, b!: RadioButton, group!: RadioGroup;
    const { device } = launch((ctx) => {
      group = new RadioGroup(ctx);
      a = new RadioButton(ctx);
      a.setText('Small');
      b = new RadioButton(ctx);
      b.setText('Large');
      group.addView(a);
      group.addView(b);
      const frame = new FrameLayout(ctx);
      frame.addView(group, -1, new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
      return frame;
    });
    const ids: number[] = [];
    group.setOnCheckedChangeListener((_g, id) => ids.push(id));
    device.tap(...center(a));
    expect(group.getCheckedRadioButtonId()).toBe(a.getId());
    device.tap(...center(b));
    expect(a.isChecked()).toBe(false);
    expect(b.isChecked()).toBe(true);
    device.tap(...center(b));
    expect(b.isChecked()).toBe(true);
    expect(ids).toEqual([a.getId(), b.getId()]);
    group.clearCheck();
    expect(b.isChecked()).toBe(false);
    expect(group.getCheckedRadioButtonId()).toBe(View.NO_ID);
  });

  it('the M3 switch animates its thumb to the end', () => {
    const { device, view } = single((ctx) => new MaterialSwitch(ctx));
    expect(view.getWidth()).toBe(52);
    const [, cy] = center(view);
    const thumbOn = view.getLeft() + 36;
    device.tap(...center(view));
    device.settle();
    expect(view.isChecked()).toBe(true);
    expect(near(rgb(device, thumbOn, cy), [255, 255, 255])).toBe(true);
    expect(near(rgb(device, view.getLeft() + 10, cy), hex(Color.parseColor('#6750A4')), 20)).toBe(true);
  });
});

describe('progress and sliders', () => {
  it('a determinate linear indicator draws primary up to its progress, then the track', () => {
    const { device, view } = single((ctx) => {
      const p = new LinearProgressIndicator(ctx);
      p.setProgress(50);
      return p;
    }, new FrameLayoutParams(400, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    expect(view.getHeight()).toBe(4);
    const y = center(view)[1];
    expect(near(rgb(device, view.getLeft() + 100, y), hex(Color.parseColor('#6750A4')), 20)).toBe(true);
    expect(near(rgb(device, view.getLeft() + 300, y), hex(Color.parseColor('#E8DEF8')), 20)).toBe(true);
    view.setProgressCompat(90, true);
    device.advance(30);
    const mid = (view as unknown as { visualProgress: number }).visualProgress;
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(90);
    device.advance(100);
    expect(view.getProgress()).toBe(90);
  });

  it('a seek bar follows a drag and reports user changes', () => {
    const { device, view } = single((ctx) => new SeekBar(ctx), new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    const events: string[] = [];
    view.setOnSeekBarChangeListener({
      onStartTrackingTouch: () => events.push('start'),
      onProgressChanged: (_s, p, fromUser) => events.push(`${p}${fromUser ? 'u' : ''}`),
      onStopTrackingTouch: () => events.push('stop'),
    });
    const y = center(view)[1];
    const width = view.getWidth() - 32;
    device.drag(16 + width * 0.2, y, width * 0.5, 0);
    expect(view.getProgress()).toBe(70);
    expect(events[0]).toBe('start');
    expect(events[events.length - 1]).toBe('stop');
    expect(events).toContain('70u');
    view.setProgress(10);
    expect(events[events.length - 1]).toBe('10');
  });

  it('inside a scroll view a vertical drag scrolls instead of seeking', () => {
    let seek!: SeekBar, scroll!: ScrollView;
    const { device } = launch((ctx) => {
      scroll = new ScrollView(ctx);
      const col = new LinearLayout(ctx);
      col.setOrientation(LinearLayout.VERTICAL);
      seek = new SeekBar(ctx);
      col.addView(seek, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 48));
      const filler = new View(ctx);
      col.addView(filler, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 3000));
      scroll.addView(col);
      return scroll;
    });
    const [x, y] = center(seek);
    device.drag(x, y, 0, -200);
    device.settle();
    expect(seek.getProgress()).toBe(0);
    expect(scroll.getScrollY()).toBeGreaterThan(100);
  });

  it('a slider snaps taps to its step and notifies listeners', () => {
    const { device, view } = single((ctx) => {
      const s = new Slider(ctx);
      s.setValueFrom(0);
      s.setValueTo(10);
      s.setStepSize(1);
      return s;
    }, new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    const values: Array<[number, boolean]> = [];
    view.addOnChangeListener((_s, v, fromUser) => values.push([v, fromUser]));
    const trackLeft = view.getLeft() + 8;
    const trackWidth = view.getWidth() - 16;
    device.tap(trackLeft + trackWidth * 0.68, center(view)[1]);
    expect(view.getValue()).toBe(7);
    expect(values).toEqual([[7, true]]);
    view.setValue(3);
    expect(values[1]).toEqual([3, false]);
    expect(() => view.setValue(11)).toThrow(/valueTo/);
  });
});

describe('chips', () => {
  it('filter chips toggle and chip groups enforce single selection', () => {
    let group!: ChipGroup;
    const chips: Chip[] = [];
    const { device } = launch((ctx) => {
      group = new ChipGroup(ctx);
      group.setSingleSelection(true);
      for (const label of ['Day', 'Week', 'Month']) {
        const c = new Chip(ctx, ChipStyle.FILTER);
        c.setText(label);
        chips.push(c);
        group.addView(c);
      }
      const frame = new FrameLayout(ctx);
      frame.addView(group, -1, new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
      return frame;
    });
    expect(chips[0]!.getHeight()).toBe(48);
    expect(chips[1]!.getLeft()).toBeCloseTo(chips[0]!.getRight() + 8);
    const changes: number[][] = [];
    group.setOnCheckedStateChangeListener((_g, ids) => changes.push(ids));
    device.tap(...center(chips[0]!));
    device.tap(...center(chips[2]!));
    expect(chips[0]!.isChecked()).toBe(false);
    expect(group.getCheckedChipId()).toBe(chips[2]!.getId());
    expect(changes[changes.length - 1]).toEqual([chips[2]!.getId()]);
    // a checked chip is wider (it shows the check icon)
    expect(chips[2]!.getWidth()).toBeGreaterThan(chips[1]!.getWidth());
  });

  it('input chips report close icon clicks', () => {
    let closed = 0;
    let clicked = 0;
    const { device, view } = single((ctx) => {
      const c = new Chip(ctx, ChipStyle.INPUT);
      c.setText('alice@example.com');
      c.setOnCloseIconClickListener(() => closed++);
      c.setOnClickListener(() => clicked++);
      return c;
    });
    const [, cy] = center(view);
    device.tap(view.getRight() - 16, cy);
    expect(closed).toBe(1);
    expect(clicked).toBe(0);
    device.tap(view.getLeft() + 30, cy);
    expect(clicked).toBe(1);
  });
});

describe('FABs and cards', () => {
  it('a FAB is 56 dp, hides and shows with an animation', () => {
    const { device, view } = single((ctx) => {
      const fab = new FloatingActionButton(ctx);
      fab.setImageResource('add');
      return fab;
    });
    expect([view.getWidth(), view.getHeight()]).toEqual([56, 56]);
    expect(view.getElevation()).toBe(6);
    expect(near(rgb(device, view.getLeft() + 6, center(view)[1]), hex(Color.parseColor('#EADDFF')))).toBe(true);
    view.hide();
    device.advance(80);
    expect(view.getScaleX()).toBeLessThan(1);
    expect(view.getVisibility()).toBe(View.VISIBLE);
    device.advance(200);
    expect(view.getVisibility()).toBe(View.GONE);
    view.show();
    device.advance(300);
    expect(view.getScaleX()).toBe(1);
    expect(view.getVisibility()).toBe(View.VISIBLE);
  });

  it('an extended FAB shrinks to its icon', () => {
    const { device, view } = single((ctx) => {
      const fab = new ExtendedFloatingActionButton(ctx);
      fab.setText('Compose');
      fab.setIcon('edit');
      return fab;
    });
    expect(view.getHeight()).toBe(56);
    const wide = view.getWidth();
    expect(wide).toBeGreaterThan(120);
    view.shrink();
    device.advance(400);
    expect(view.getWidth()).toBe(56);
    expect(view.isExtended()).toBe(false);
    view.extend();
    device.advance(400);
    expect(view.getWidth()).toBeCloseTo(wide);
  });

  it('a checkable card toggles its checked state', () => {
    const { view } = single((ctx) => {
      const card = new MaterialCardView(ctx);
      card.setCheckable(true);
      return card;
    }, new FrameLayoutParams(200, 120, Gravity.CENTER));
    view.toggle();
    expect(view.isChecked()).toBe(true);
    expect(view.getDrawableState()).toContain('state_checked');
    expect(view.getRadius()).toBe(12);
  });
});

describe('Toast', () => {
  it('shows in a toast window for LENGTH_SHORT, then the next queued toast', () => {
    const { device, activity } = launch((ctx) => new FrameLayout(ctx));
    const wm = device.android.windowManager;
    const toastWindows = () => wm.windows.filter((w) => w.params.type === WindowType.TYPE_TOAST).length;
    const first = Toast.makeText(activity, 'First', Toast.LENGTH_SHORT);
    const second = Toast.makeText(activity, 'Second', Toast.LENGTH_LONG);
    const log: string[] = [];
    first.addCallback({ onToastShown: () => log.push('first+'), onToastHidden: () => log.push('first-') });
    second.addCallback({ onToastShown: () => log.push('second+'), onToastHidden: () => log.push('second-') });
    first.show();
    second.show();
    expect(toastWindows()).toBe(1);
    expect(Toast.current(device.kernel)).toBe(first);
    device.advance(1900);
    expect(log).toEqual(['first+']);
    device.advance(500);
    expect(log).toEqual(['first+', 'first-', 'second+']);
    expect(Toast.current(device.kernel)).toBe(second);
    device.advance(3400);
    expect(log).toEqual(['first+', 'first-', 'second+']);
    device.advance(500);
    expect(log).toEqual(['first+', 'first-', 'second+', 'second-']);
    expect(toastWindows()).toBe(0);
  });
});

describe('Snackbar', () => {
  it('slides up from the bottom, waits, then times out', () => {
    let root!: FrameLayout;
    const { device } = launch((ctx) => (root = new FrameLayout(ctx)));
    const events: string[] = [];
    const bar = Snackbar.make(root, 'Saved', Snackbar.LENGTH_SHORT);
    bar.addCallback({ onShown: () => events.push('shown'), onDismissed: (_s, e) => events.push(`dismissed:${e}`) });
    bar.show();
    device.advance(50);
    const view = bar.getView();
    expect(view.getTranslationY()).toBeGreaterThan(0);
    // 8 dp from the sides, above the 24 dp navigation inset
    expect(view.getLeft()).toBe(8);
    expect(view.getBottom()).toBe(923 - 8 - 24);
    device.advance(500);
    expect(view.getTranslationY()).toBe(0);
    expect(events).toEqual(['shown']);
    device.advance(1400);
    expect(events).toEqual(['shown']);
    device.advance(700);
    expect(events).toEqual(['shown', `dismissed:${Snackbar.DISMISS_EVENT_TIMEOUT}`]);
    expect(view.getParent()).toBeNull();
  });

  it('dismisses with its action, and a new snackbar replaces the current one', () => {
    let root!: FrameLayout;
    const { device } = launch((ctx) => (root = new FrameLayout(ctx)));
    const events: string[] = [];
    let undone = 0;
    const first = Snackbar.make(root, 'Deleted', Snackbar.LENGTH_INDEFINITE).setAction('Undo', () => undone++);
    first.addCallback({ onDismissed: (_s, e) => events.push(`first:${e}`) });
    first.show();
    device.advance(700);
    const action = (first.getView() as FrameLayout).getChildAt(0) as LinearLayout;
    const button = action.getChildAt(1)!;
    device.tap(...center(button));
    expect(undone).toBe(1);
    device.advance(700);
    expect(events).toEqual([`first:${Snackbar.DISMISS_EVENT_ACTION}`]);

    const a = Snackbar.make(root, 'A', Snackbar.LENGTH_INDEFINITE);
    const b = Snackbar.make(root, 'B', Snackbar.LENGTH_INDEFINITE);
    a.addCallback({ onDismissed: (_s, e) => events.push(`a:${e}`) });
    a.show();
    device.advance(700);
    b.show();
    // a slides out (500 ms), then b slides in (500 ms)
    device.advance(1200);
    expect(events[events.length - 1]).toBe(`a:${Snackbar.DISMISS_EVENT_CONSECUTIVE}`);
    expect(b.isShown()).toBe(true);
  });
});
