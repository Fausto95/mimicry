import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, Adapter, AppBarLayout, AppCompatDelegate, BottomNavigationView, ButtonStyle, CardStyle, Chip, ChipGroup, ChipStyle, CoordinatorLayout,
  CoordinatorLayoutParams, FloatingActionButton, Gravity, LayoutParams, LinearLayout, LinearLayoutManager, LinearLayoutParams, MaterialAlertDialogBuilder,
  MaterialButton, MaterialCardView, MaterialDivider, MaterialDividerItemDecoration, MaterialSwitch, MaterialToolbar, MenuItem, RecyclerView,
  ScrollingViewBehavior, ScrollView, Slider, Snackbar, TextAppearance, TextView, ViewHolder, WindowType, type Context, type ViewGroup,
} from '@mimicry/os-android';

/**
 * Whole Material 3 screens composed the way an app would, rendered to
 * artifacts/os-android/*.png for visual review, with a few checks that the
 * pieces cooperate (scrolling lifts the app bar, the snackbar pushes the
 * FAB, the dialog sits over a scrim).
 */
const OUT = 'artifacts/os-android';

function save(device: Device, name: string): PNG {
  mkdirSync(OUT, { recursive: true });
  const png = device.screenshot();
  writeFileSync(`${OUT}/${name}.png`, png);
  return PNG.sync.read(device.screenshot(1));
}

function luminance(png: PNG, x: number, y: number): number {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return (png.data[i]! + png.data[i + 1]! + png.data[i + 2]!) / 3;
}

class MessageRow extends ViewHolder {
  constructor(root: LinearLayout, readonly title: TextView, readonly body: TextView) {
    super(root);
  }
}

const SENDERS = ['Ali Connors', 'Sandra Adams', 'Trevor Hansen', 'Britta Holt', 'Jennifer Scott', 'Sam Moore'];

class Inbox extends Adapter<MessageRow> {
  getItemCount(): number {
    return 40;
  }
  onCreateViewHolder(parent: ViewGroup): MessageRow {
    const ctx = parent.context;
    const root = new LinearLayout(ctx);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(16, 12, 24, 12);
    const title = new TextView(ctx);
    title.setTextAppearance(TextAppearance.BodyLarge);
    title.setTextColor(ctx.getColor('colorOnSurface'));
    const body = new TextView(ctx);
    body.setTextAppearance(TextAppearance.BodyMedium);
    body.setTextColor(ctx.getColor('colorOnSurfaceVariant'));
    body.setMaxLines(1);
    root.addView(title);
    root.addView(body);
    return new MessageRow(root, title, body);
  }
  onBindViewHolder(holder: MessageRow, position: number): void {
    holder.title.setText(SENDERS[position % SENDERS.length]!);
    holder.body.setText(`Brunch this weekend? I'll be in your neighborhood doing errands (${position + 1})`);
  }
}

describe('screens', () => {
  it('inbox: toolbar, list, FAB, bottom navigation and a snackbar', () => {
    const device = createDevice({ device: 'pixel-9' });
    let root!: CoordinatorLayout;
    let bar!: AppBarLayout;
    let fab!: FloatingActionButton;
    let nav!: BottomNavigationView;
    let list!: RecyclerView;
    class Main extends Activity {
      protected override onCreate(): void {
        const column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(this.getColor('colorSurface'));
        root = new CoordinatorLayout(this);
        bar = new AppBarLayout(this);
        const toolbar = new MaterialToolbar(this);
        toolbar.setTitle('Inbox');
        toolbar.setNavigationIcon('menu');
        toolbar.inflateMenu([
          { id: 1, title: 'Search', icon: 'search', showAsAction: MenuItem.SHOW_AS_ACTION_IF_ROOM },
          { id: 2, title: 'Settings' },
        ]);
        bar.addView(toolbar, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        root.addView(bar, -1, new CoordinatorLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        list = new RecyclerView(this);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.addItemDecoration(new MaterialDividerItemDecoration(this, MaterialDividerItemDecoration.VERTICAL));
        list.setAdapter(new Inbox());
        const lp = new CoordinatorLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
        lp.setBehavior(new ScrollingViewBehavior());
        root.addView(list, -1, lp);
        bar.setLiftOnScrollTargetView(list);
        fab = new FloatingActionButton(this);
        fab.setImageResource('edit');
        fab.setContentDescription('Compose');
        const fl = new CoordinatorLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        fl.setMargins(0, 0, 16, 16);
        root.addView(fab, -1, fl);
        column.addView(root, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        nav = new BottomNavigationView(this);
        nav.inflateMenu([
          { id: 10, title: 'Mail', icon: 'mail' },
          { id: 11, title: 'Chat', icon: 'chat_bubble' },
          { id: 12, title: 'Rooms', icon: 'group' },
          { id: 13, title: 'Meet', icon: 'videocam' },
        ]);
        nav.getOrCreateBadge(11).setNumber(3);
        column.addView(nav, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        this.setContentView(column);
      }
    }
    new Main(device.kernel, device.android.windowManager).launch();
    device.advance(32);
    expect(bar.isLifted()).toBe(false);

    device.drag(200, 600, 0, -200);
    device.settle();
    expect(list.computeVerticalScrollOffset()).toBeGreaterThan(0);
    expect(bar.isLifted()).toBe(true);

    const snackbar = Snackbar.make(root, 'Message archived', Snackbar.LENGTH_LONG).setAction('Undo', () => {});
    snackbar.show();
    device.advance(700);
    const snack = snackbar.getView();
    // the FAB rides above the snackbar, which sits above the navigation bar
    expect(fab.getBottom() + fab.getTranslationY()).toBeCloseTo(snack.getTop() - 16);
    expect(snack.getBottom()).toBeLessThanOrEqual(nav.getTop());

    const png = save(device, 'screen-inbox');
    // the lifted app bar is tinted away from the plain surface below the list rows
    expect(luminance(png, 200, 60)).not.toBe(luminance(png, 200, 500));
  });

  it('settings (dark): cards, switches, chips, slider and an alert dialog', () => {
    const device = createDevice({ device: 'pixel-9' });
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES, device.kernel);
    let activity!: Activity;
    let wifi!: MaterialSwitch;

    function row(ctx: Context, title: string, summary: string, checked: boolean): [LinearLayout, MaterialSwitch] {
      const line = new LinearLayout(ctx);
      line.setGravity(Gravity.CENTER_VERTICAL);
      line.setPadding(16, 12, 16, 12);
      const texts = new LinearLayout(ctx);
      texts.setOrientation(LinearLayout.VERTICAL);
      const t = new TextView(ctx);
      t.setTextAppearance(TextAppearance.BodyLarge);
      t.setTextColor(ctx.getColor('colorOnSurface'));
      t.setText(title);
      const s = new TextView(ctx);
      s.setTextAppearance(TextAppearance.BodyMedium);
      s.setText(summary);
      texts.addView(t);
      texts.addView(s);
      line.addView(texts, -1, new LinearLayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
      const toggle = new MaterialSwitch(ctx);
      toggle.setChecked(checked, false);
      toggle.setContentDescription(title);
      line.addView(toggle);
      return [line, toggle];
    }

    function header(ctx: Context, text: string): TextView {
      const h = new TextView(ctx);
      h.setTextAppearance(TextAppearance.TitleSmall);
      h.setTextColor(ctx.getColor('colorPrimary'));
      h.setText(text);
      h.setPadding(16, 24, 16, 8);
      h.setAccessibilityHeading(true);
      return h;
    }

    class Settings extends Activity {
      protected override onCreate(): void {
        activity = this;
        const column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(this.getColor('colorSurface'));
        const bar = new AppBarLayout(this);
        const toolbar = new MaterialToolbar(this);
        toolbar.setTitle('Settings');
        toolbar.setNavigationIcon('arrow_back');
        bar.addView(toolbar, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        column.addView(bar, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        const scroll = new ScrollView(this);
        const content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(16, 0, 16, 24);

        content.addView(header(this, 'Network'));
        const card = new MaterialCardView(this, CardStyle.FILLED);
        const rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        const [wifiRow, wifiSwitch] = row(this, 'Wi‑Fi', 'Home network', true);
        wifi = wifiSwitch;
        rows.addView(wifiRow, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        rows.addView(new MaterialDivider(this), -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        rows.addView(row(this, 'Bluetooth', 'Off', false)[0], -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        card.addView(rows);
        content.addView(card, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        content.addView(header(this, 'Notifications'));
        const chips = new ChipGroup(this);
        for (const [label, on] of [['Messages', true], ['Mentions', true], ['Reactions', false], ['Calls', false]] as const) {
          const chip = new Chip(this, ChipStyle.FILTER);
          chip.setText(label);
          chip.setChecked(on, false);
          chips.addView(chip);
        }
        content.addView(chips, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        content.addView(header(this, 'Text size'));
        const slider = new Slider(this);
        slider.setValueFrom(0);
        slider.setValueTo(10);
        slider.setValue(6);
        content.addView(slider, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        const buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.END);
        buttons.setPadding(0, 16, 0, 0);
        const reset = new MaterialButton(this, ButtonStyle.OUTLINED);
        reset.setText('Reset');
        const save = new MaterialButton(this);
        save.setText('Save');
        const gap = new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        gap.setMargins(0, 0, 8, 0);
        buttons.addView(reset, -1, gap);
        buttons.addView(save);
        content.addView(buttons, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        scroll.addView(content, -1, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        column.addView(scroll, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
        this.setContentView(column);
      }
    }
    new Settings(device.kernel, device.android.windowManager).launch();
    device.advance(32);

    const [x, y] = wifi.getLocationInWindow();
    device.tap(x + wifi.getWidth() / 2, y + wifi.getHeight() / 2);
    device.settle();
    expect(wifi.isChecked()).toBe(false);
    expect(wifi.getStateDescription()).toBe('Off');
    const screen = save(device, 'screen-settings-dark');
    // night resources: a dark surface
    expect(luminance(screen, 200, 700)).toBeLessThan(40);

    new MaterialAlertDialogBuilder(activity)
      .setTitle('Reset settings?')
      .setMessage('Network, notification and text size settings return to their defaults.')
      .setNegativeButton('Cancel', null)
      .setPositiveButton('Reset', null)
      .show();
    device.settle();
    expect(device.android.windowManager.windows.some((w) => w.params.type === WindowType.TYPE_APPLICATION_ATTACHED_DIALOG)).toBe(true);
    const dialog = save(device, 'screen-settings-dialog');
    // the scrim darkens the screen around the dialog
    expect(luminance(dialog, 20, 700)).toBeLessThan(luminance(screen, 20, 700) + 1);
  });
});
