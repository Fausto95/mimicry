import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, AppBarLayout, BottomNavigationView, CoordinatorLayout, CoordinatorLayoutParams, FloatingActionButton, FrameLayout, Gravity, LayoutParams,
  LinearLayout, LinearLayoutParams, MaterialToolbar, MenuItem, NavigationBarView, PopupMenu, ScrollView, ScrollingViewBehavior, Snackbar, TextView, View,
  WindowType,
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

function center(v: View): [number, number] {
  const [x, y] = v.getLocationInWindow();
  return [x + v.getWidth() / 2, y + v.getHeight() / 2];
}

function rgb(device: Device, x: number, y: number): number[] {
  const png = PNG.sync.read(device.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe('MaterialToolbar', () => {
  it('lays out navigation, title, actions and overflow; items call the listener', () => {
    let toolbar!: MaterialToolbar;
    const { device } = launch((ctx) => {
      const bar = new AppBarLayout(ctx);
      toolbar = new MaterialToolbar(ctx);
      toolbar.setTitle('Inbox');
      toolbar.setSubtitle('3 unread');
      toolbar.setNavigationIcon('arrow_back');
      toolbar.inflateMenu([
        { id: 1, title: 'Search', icon: 'search', showAsAction: MenuItem.SHOW_AS_ACTION_ALWAYS },
        { id: 2, title: 'Share', icon: 'share', showAsAction: MenuItem.SHOW_AS_ACTION_IF_ROOM },
        { id: 3, title: 'Archive', icon: 'archive', showAsAction: MenuItem.SHOW_AS_ACTION_IF_ROOM },
        { id: 4, title: 'Settings' },
      ]);
      bar.addView(toolbar);
      const frame = new FrameLayout(ctx);
      frame.addView(bar, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
      return frame;
    });
    const clicked: number[] = [];
    let navs = 0;
    toolbar.setOnMenuItemClickListener((item) => {
      clicked.push(item.getItemId());
      return true;
    });
    toolbar.setNavigationOnClickListener(() => navs++);
    expect(toolbar.getHeight()).toBe(64);
    // the app bar pads itself below the 48 dp status bar
    expect(toolbar.getLocationInWindow()[1]).toBe(48);
    expect(toolbar.titleTextView.getLeft()).toBe(72);
    // three action slots under 500 dp: search, share and the overflow (archive and settings overflow)
    expect(toolbar.actionViews.length).toBe(2);
    expect(toolbar.overflowView).not.toBeNull();
    expect(toolbar.overflowView!.getRight()).toBe(411 - 4);
    device.tap(...center(toolbar.actionViews[0]!));
    device.tap(...center(toolbar.navigationButton!));
    expect(clicked).toEqual([1]);
    expect(navs).toBe(1);
    device.tap(...center(toolbar.overflowView!));
    device.advance(200);
    expect(toolbar.isOverflowMenuShowing()).toBe(true);
    const panel = toolbar.overflowPopup!.panelView as LinearLayout;
    expect(panel.getChildCount()).toBe(2);
    expect(String((panel.getChildAt(0) as TextView).getText())).toBe('Archive');
    device.tap(...center(panel.getChildAt(1)!));
    expect(clicked).toEqual([1, 4]);
    expect(toolbar.isOverflowMenuShowing()).toBe(false);
  });

  it('centers the title on request', () => {
    let toolbar!: MaterialToolbar;
    launch((ctx) => {
      toolbar = new MaterialToolbar(ctx);
      toolbar.setTitle('Centered');
      toolbar.setTitleCentered(true);
      const frame = new FrameLayout(ctx);
      frame.addView(toolbar, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
      return frame;
    });
    const t = toolbar.titleTextView;
    expect(t.getLeft() + t.getWidth() / 2).toBeCloseTo(411 / 2);
  });
});

describe('PopupMenu', () => {
  it('opens under its anchor, dismisses on outside taps and on back', () => {
    let anchor!: TextView;
    const { device, activity } = launch((ctx) => {
      const frame = new FrameLayout(ctx);
      anchor = new TextView(ctx);
      anchor.setText('Sort');
      frame.addView(anchor, -1, new LayoutParams(100, 48));
      return frame;
    });
    const popup = new PopupMenu(activity, anchor);
    popup.getMenu().add('Newest');
    popup.getMenu().add('Oldest');
    let dismissed = 0;
    popup.setOnDismissListener(() => dismissed++);
    popup.show();
    device.advance(200);
    const wm = device.android.windowManager;
    expect(wm.windows.some((w) => w.params.type === WindowType.TYPE_APPLICATION_PANEL)).toBe(true);
    const panel = popup.panelView!;
    expect(panel.getTop()).toBe(48);
    expect(panel.getWidth()).toBeGreaterThanOrEqual(112);
    device.tap(300, 700);
    expect(dismissed).toBe(1);
    popup.show();
    device.advance(200);
    device.back();
    expect(dismissed).toBe(2);
  });
});

describe('BottomNavigationView', () => {
  it('selects items, consults the listener and draws the active indicator', () => {
    let nav!: BottomNavigationView;
    const { device } = launch((ctx) => {
      const column = new LinearLayout(ctx);
      column.setOrientation(LinearLayout.VERTICAL);
      column.addView(new View(ctx), -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
      nav = new BottomNavigationView(ctx);
      nav.inflateMenu([
        { id: 1, title: 'Home', icon: 'home' },
        { id: 2, title: 'Search', icon: 'search' },
        { id: 3, title: 'Profile', icon: 'person' },
      ]);
      column.addView(nav, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
      return column;
    });
    // 80 dp plus the 24 dp navigation inset
    expect(nav.getHeight()).toBe(104);
    expect(nav.getSelectedItemId()).toBe(1);
    const selected: number[] = [];
    const reselected: number[] = [];
    nav.setOnItemSelectedListener((item) => {
      selected.push(item.getItemId());
      return item.getItemId() !== 3;
    });
    nav.setOnItemReselectedListener((item) => reselected.push(item.getItemId()));
    const items = nav.itemViews;
    device.tap(...center(items[1]!));
    device.advance(300);
    expect(nav.getSelectedItemId()).toBe(2);
    device.tap(...center(items[2]!));
    expect(nav.getSelectedItemId()).toBe(2);
    device.tap(...center(items[1]!));
    expect(selected).toEqual([2, 3]);
    expect(reselected).toEqual([2]);
    // the indicator pill behind the selected icon is secondaryContainer (once the ripple faded)
    device.advance(400);
    const [x] = center(items[1]!);
    const [, top] = items[1]!.getLocationInWindow();
    expect(rgb(device, x - 20, top + 28)).toEqual([0xe8, 0xde, 0xf8]);
    expect(nav.getLabelVisibilityMode()).toBe(NavigationBarView.LABEL_VISIBILITY_LABELED);
  });

  it('shows badges and refuses more than five items', () => {
    let nav!: BottomNavigationView;
    launch((ctx) => {
      nav = new BottomNavigationView(ctx);
      nav.inflateMenu([{ id: 1, title: 'A', icon: 'home' }, { id: 2, title: 'B', icon: 'mail' }]);
      const frame = new FrameLayout(ctx);
      frame.addView(nav, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
      return frame;
    });
    const badge = nav.getOrCreateBadge(2);
    badge.setNumber(1200);
    expect(badge.text()).toBe('999+');
    badge.clearNumber();
    expect(badge.text()).toBeNull();
    expect(() => nav.inflateMenu([3, 4, 5, 6].map((id) => ({ id, title: String(id) })))).toThrow(/Maximum number of items/);
  });
});

describe('AppBarLayout and CoordinatorLayout', () => {
  it('lifts when its scrolling target scrolls', () => {
    let bar!: AppBarLayout, scroll!: ScrollView;
    const { device } = launch((ctx) => {
      const column = new LinearLayout(ctx);
      column.setOrientation(LinearLayout.VERTICAL);
      bar = new AppBarLayout(ctx);
      const toolbar = new MaterialToolbar(ctx);
      toolbar.setTitle('Lift');
      bar.addView(toolbar);
      column.addView(bar);
      scroll = new ScrollView(ctx);
      const content = new View(ctx);
      content.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, 3000));
      scroll.addView(content);
      column.addView(scroll, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
      bar.setLiftOnScrollTargetView(scroll);
      return column;
    });
    expect(bar.isLifted()).toBe(false);
    expect(rgb(device, 120, 30)).toEqual([0xfe, 0xf7, 0xff]);
    device.drag(200, 600, 0, -200);
    device.settle();
    expect(bar.isLifted()).toBe(true);
    expect(rgb(device, 120, 30)).toEqual([0xf3, 0xed, 0xf7]);
  });

  it('puts scrolling content under the app bar and moves the FAB out of the snackbar’s way', () => {
    let root!: CoordinatorLayout, bar!: AppBarLayout, content!: View, fab!: FloatingActionButton;
    const { device } = launch((ctx) => {
      root = new CoordinatorLayout(ctx);
      bar = new AppBarLayout(ctx);
      bar.addView(new MaterialToolbar(ctx));
      root.addView(bar, -1, new CoordinatorLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
      content = new View(ctx);
      const lp = new CoordinatorLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
      lp.setBehavior(new ScrollingViewBehavior());
      root.addView(content, -1, lp);
      fab = new FloatingActionButton(ctx);
      fab.setImageResource('add');
      const fl = new CoordinatorLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
      fl.setMargins(0, 0, 16, 16);
      root.addView(fab, -1, fl);
      return root;
    });
    expect(content.getTop()).toBe(bar.getBottom());
    expect(content.getBottom()).toBe(923);
    expect(fab.getTranslationY()).toBe(0);
    const bar2 = Snackbar.make(fab, 'Sent', Snackbar.LENGTH_SHORT);
    bar2.show();
    device.advance(700);
    const snack = bar2.getView();
    expect(snack.getParent()).toBe(root);
    expect(fab.getBottom() + fab.getTranslationY()).toBeCloseTo(snack.getTop() - 16);
    device.advance(3000);
    expect(fab.getTranslationY()).toBe(0);
  });
});
