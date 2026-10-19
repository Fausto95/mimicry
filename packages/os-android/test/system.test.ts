import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, ActivityInfo, AppCompatDelegate, Build, CheckBox, ClipData, ClipboardManager, ColorDrawable, Configuration, Context, EdgeToEdge, FrameLayout,
  HapticFeedbackConstants, KernelPreferenceStore, LayoutParams, MaterialSwitch, PreferenceManager, TextView, VibrationEffect, Vibrator, View, ViewCompat,
  WindowCompat, WindowInsetsCompat, type WindowInsets,
} from '@mimicry/os-android';

function launch(build: (activity: Activity) => View, device = createDevice({ device: 'pixel-9' })): { device: Device; activity: Activity } {
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

function white(ctx: Context): FrameLayout {
  const root = new FrameLayout(ctx);
  root.setBackground(new ColorDrawable(0xffffffff | 0));
  return root;
}

/** Pixels in a band of the screen (dp rows) that are darker than mid gray. */
function darkPixels(device: Device, top: number, bottom: number, left = 0, right = Infinity): number {
  const png = PNG.sync.read(device.screenshot(1));
  let n = 0;
  for (let y = Math.round(top); y < Math.round(bottom); y++) {
    for (let x = left; x < Math.min(right, png.width); x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i]! + png.data[i + 1]! + png.data[i + 2]! < 3 * 128) n++;
    }
  }
  return n;
}

describe('SharedPreferences', () => {
  it('keeps typed values, rejects reads of the wrong type, and notifies listeners', () => {
    const { activity } = launch((ctx) => new View(ctx));
    const prefs = activity.getSharedPreferences('settings', 0);
    const heard: (string | null)[] = [];
    prefs.registerOnSharedPreferenceChangeListener((_p, key) => heard.push(key));
    prefs.edit().putString('name', 'Ada').putInt('count', 3).putBoolean('dark', true).putFloat('ratio', 0.5).putStringSet('tags', new Set(['a', 'b'])).apply();
    expect(prefs.getString('name', null)).toBe('Ada');
    expect(prefs.getInt('count', 0)).toBe(3);
    expect(prefs.getBoolean('dark', false)).toBe(true);
    expect(prefs.getFloat('ratio', 0)).toBe(0.5);
    expect([...prefs.getStringSet('tags', null)!].sort()).toEqual(['a', 'b']);
    expect(prefs.getInt('missing', 7)).toBe(7);
    expect(() => prefs.getInt('name', 0)).toThrow(/ClassCastException/);
    expect(heard.sort()).toEqual(['count', 'dark', 'name', 'ratio', 'tags']);

    heard.length = 0;
    prefs.edit().remove('count').apply();
    expect(prefs.contains('count')).toBe(false);
    expect(heard).toEqual(['count']);
    // the same name is the same instance, as Context.getSharedPreferences caches it
    expect(activity.getSharedPreferences('settings', 0)).toBe(prefs);
  });

  it('persists in kernel storage under shared_prefs:<name> and reloads on another boot', () => {
    const first = launch((ctx) => new View(ctx));
    first.activity.getSharedPreferences('settings', 0).edit().putLong('launches', 42).putString('user', 'ada').commit();
    const ns = KernelPreferenceStore.namespace('settings');
    expect(ns).toBe('shared_prefs:settings');
    expect(JSON.parse(first.device.kernel.storage.get(ns, 'launches')!)).toEqual({ type: 'long', value: 42 });

    const device = createDevice({ device: 'pixel-9' });
    device.kernel.storage.load(first.device.kernel.storage.snapshot());
    const second = launch((ctx) => new View(ctx), device);
    const prefs = second.activity.getSharedPreferences('settings', 0);
    expect(prefs.getLong('launches', 0)).toBe(42);
    expect(prefs.getString('user', null)).toBe('ada');
  });

  it('clear() empties the file; the default preferences use <package>_preferences', () => {
    const { activity, device } = launch((ctx) => new View(ctx));
    const prefs = PreferenceManager.getDefaultSharedPreferences(activity);
    prefs.edit().putBoolean('onboarded', true).apply();
    expect(device.kernel.storage.keys(KernelPreferenceStore.namespace(`${activity.getPackageName()}_preferences`))).toEqual(['onboarded']);
    prefs.edit().clear().apply();
    expect(prefs.getAll().size).toBe(0);
  });
});

describe('window insets', () => {
  it('draws edge to edge by default: content fills the screen and reads the bars from insets', () => {
    let content!: View;
    let seen: WindowInsets | null = null;
    const { device } = launch((ctx) => {
      content = new View(ctx);
      ViewCompat.setOnApplyWindowInsetsListener(content, (_v, insets) => {
        seen = insets;
        return insets;
      });
      return content;
    });
    expect(content.getHeight()).toBe(device.kernel.viewport.height);
    const bars = seen!.getInsets(WindowInsetsCompat.Type.systemBars());
    expect(bars.top).toBe(48);
    expect(bars.bottom).toBe(24);
    expect(ViewCompat.getRootWindowInsets(content)?.getInsets(WindowInsetsCompat.Type.statusBars()).top).toBe(48);
  });

  it('setDecorFitsSystemWindows(true) pads the content clear of the bars', () => {
    let content!: View;
    const { device, activity } = launch((ctx) => (content = new View(ctx)));
    WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), true);
    device.advance(32);
    expect(content.getLocationInWindow()[1]).toBe(48);
    expect(content.getHeight()).toBe(device.kernel.viewport.height - 48 - 24);
  });

  it('hiding the status bar removes its inset and stops SystemUI drawing it', () => {
    let seen: WindowInsets | null = null;
    const { device, activity } = launch((ctx) => {
      const root = white(ctx);
      ViewCompat.setOnApplyWindowInsetsListener(root, (_v, insets) => {
        seen = insets;
        return insets;
      });
      return root;
    });
    expect(darkPixels(device, 0, 48)).toBeGreaterThan(50);
    const controller = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
    controller.hide(WindowInsetsCompat.Type.statusBars());
    device.advance(32);
    expect(seen!.getInsets(WindowInsetsCompat.Type.statusBars()).top).toBe(0);
    expect(seen!.isVisible(WindowInsetsCompat.Type.statusBars())).toBe(false);
    expect(darkPixels(device, 0, 48)).toBe(0);

    controller.show(WindowInsetsCompat.Type.statusBars());
    device.advance(32);
    expect(seen!.getInsets(WindowInsetsCompat.Type.statusBars()).top).toBe(48);
  });

  it('light status bars draw dark icons; turning it off draws light ones', () => {
    const { device, activity } = launch(white);
    const window = activity.getWindow();
    const controller = WindowCompat.getInsetsController(window, window.getDecorView());
    controller.setAppearanceLightStatusBars(true);
    device.advance(32);
    expect(controller.isAppearanceLightStatusBars()).toBe(true);
    // the clock, left of the camera hole (which stays black)
    expect(darkPixels(device, 0, 48, 0, 120)).toBeGreaterThan(50);

    controller.setAppearanceLightStatusBars(false);
    device.advance(32);
    expect(darkPixels(device, 0, 48, 0, 120)).toBe(0);
  });

  it('without an explicit appearance the icons follow the app theme, not the system', () => {
    const { device } = launch(white);
    expect(darkPixels(device, 0, 48, 0, 120)).toBeGreaterThan(50);
    // the app forces night while the system stays light: light icons
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES, device.kernel);
    device.advance(32);
    expect(darkPixels(device, 0, 48, 0, 120)).toBe(0);
  });

  it('EdgeToEdge.enable picks bar icons that suit the theme', () => {
    const { device, activity } = launch(white);
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES, device.kernel);
    EdgeToEdge.enable(activity);
    const window = activity.getWindow();
    const controller = WindowCompat.getInsetsController(window, window.getDecorView());
    expect(controller.isAppearanceLightStatusBars()).toBe(false);
    expect(controller.isAppearanceLightNavigationBars()).toBe(false);
    expect(window.getDecorFitsSystemWindows()).toBe(false);
  });

  it('hiding the navigation bar removes the gesture handle', () => {
    const { device, activity } = launch(white);
    const height = device.kernel.viewport.height;
    expect(darkPixels(device, height - 24, height)).toBeGreaterThan(20);
    const window = activity.getWindow();
    WindowCompat.getInsetsController(window, window.getDecorView()).hide(WindowInsetsCompat.Type.navigationBars());
    device.advance(32);
    expect(darkPixels(device, height - 24, height)).toBe(0);
  });
});

describe('configuration changes', () => {
  it('dispatches night mode to Activity.onConfigurationChanged and the view tree', () => {
    const configs: Configuration[] = [];
    const viewConfigs: Configuration[] = [];
    class Probe extends View {
      protected override onConfigurationChanged(newConfig: Configuration): void {
        viewConfigs.push(newConfig);
      }
    }
    const device = createDevice({ device: 'pixel-9' });
    class Main extends Activity {
      protected override onCreate(): void {
        const root = new FrameLayout(this);
        root.addView(new Probe(this));
        this.setContentView(root);
      }
      override onConfigurationChanged(newConfig: Configuration): void {
        configs.push(newConfig);
      }
    }
    const activity = new Main(device.kernel, device.android.windowManager);
    activity.launch();
    device.advance(32);
    expect(activity.getResources().getConfiguration().isNightModeActive()).toBe(false);

    device.kernel.env.update({ appearance: 'dark' });
    expect(configs).toHaveLength(1);
    expect(configs[0]!.isNightModeActive()).toBe(true);
    expect(viewConfigs).toHaveLength(1);
    expect(activity.getResources().getConfiguration().isNightModeActive()).toBe(true);

    // AppCompatDelegate overrides the system: forcing NO is a change back
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO, device.kernel);
    expect(configs).toHaveLength(2);
    expect(configs[1]!.isNightModeActive()).toBe(false);
    // the system going light again changes nothing the app sees
    device.kernel.env.update({ appearance: 'light' });
    expect(configs).toHaveLength(2);
  });

  it('reports orientation and font scale', () => {
    const configs: Configuration[] = [];
    const device = createDevice({ device: 'pixel-9' });
    class Main extends Activity {
      protected override onCreate(): void {
        this.setContentView(new View(this));
      }
      override onConfigurationChanged(newConfig: Configuration): void {
        configs.push(newConfig);
      }
    }
    const activity = new Main(device.kernel, device.android.windowManager);
    activity.launch();
    const before = activity.getConfiguration();
    device.kernel.env.update({ orientation: 'landscape' });
    expect(configs[0]!.orientation).toBe(Configuration.ORIENTATION_LANDSCAPE);
    expect(configs[0]!.diff(before) & ActivityInfo.CONFIG_ORIENTATION).not.toBe(0);
    expect(configs[0]!.screenWidthDp).toBeGreaterThan(configs[0]!.screenHeightDp);
    device.kernel.env.update({ fontScale: 1.3 });
    expect(configs[1]!.fontScale).toBe(1.3);
  });

  it('recreates an activity that does not handle the change, handing it saved state', () => {
    const device = createDevice({ device: 'pixel-9' });
    const created: (Record<string, unknown> | null)[] = [];
    const events: string[] = [];
    class Main extends Activity {
      protected override configChanges = 0;
      private counter = 0;
      protected override onCreate(saved: Record<string, unknown> | null): void {
        created.push(saved);
        this.counter = typeof saved?.counter === 'number' ? saved.counter : 5;
        const label = new TextView(this);
        label.setText(this.getResources().getConfiguration().isNightModeActive() ? 'night' : 'day');
        this.setContentView(label);
      }
      protected override onSaveInstanceState(out: Record<string, unknown>): void {
        out.counter = this.counter + 1;
      }
      protected override onDestroy(): void {
        events.push('destroy');
      }
      override onConfigurationChanged(): void {
        events.push('changed');
      }
    }
    new Main(device.kernel, device.android.windowManager).launch();
    device.advance(32);
    const windows = device.android.windowManager.windows.length;
    device.kernel.env.update({ appearance: 'dark' });
    device.advance(32);
    expect(events).toEqual(['destroy']);
    expect(created).toEqual([null, { counter: 6 }]);
    // the old window is gone, the new one shows the night resources
    expect(device.android.windowManager.windows.length).toBe(windows);
    const content = device.android.windowManager.windows
      .map((w) => w.view.findViewById<FrameLayout>(0x01020002))
      .find((v) => v !== null)!;
    expect((content.getChildAt(0) as TextView).getText().toString()).toBe('night');
  });
});

describe('Build, clipboard, vibrator', () => {
  it('Build.VERSION.SDK_INT follows the device descriptor', () => {
    createDevice({ device: 'pixel-9' });
    expect(Build.VERSION.SDK_INT).toBe(36);
    expect(Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM).toBe(true);
    expect(Build.MANUFACTURER).toBe('Google');
  });

  it('the clipboard holds the primary clip in memory and notifies listeners', () => {
    const { activity } = launch((ctx) => new View(ctx));
    const clipboard = activity.getSystemService<ClipboardManager>(Context.CLIPBOARD_SERVICE)!;
    let changes = 0;
    clipboard.addPrimaryClipChangedListener(() => changes++);
    expect(clipboard.hasPrimaryClip()).toBe(false);
    clipboard.setPrimaryClip(ClipData.newPlainText('code', '123456'));
    expect(clipboard.getPrimaryClip()!.getItemAt(0).getText()).toBe('123456');
    expect(clipboard.getPrimaryClipDescription()!.hasMimeType('text/*')).toBe(true);
    clipboard.clearPrimaryClip();
    expect(clipboard.hasPrimaryClip()).toBe(false);
    expect(changes).toBe(2);
    // one clipboard per device
    expect(activity.getSystemService<ClipboardManager>(Context.CLIPBOARD_SERVICE)).toBe(clipboard);
  });

  it('vibrations are recorded, and haptic feedback follows the view setting', () => {
    const { activity } = launch((ctx) => new View(ctx));
    const vibrator = activity.getSystemService<Vibrator>(Context.VIBRATOR_SERVICE)!;
    vibrator.vibrate(VibrationEffect.createOneShot(30));
    vibrator.vibrate(VibrationEffect.createWaveform([0, 10, 20], -1));
    expect(vibrator.history.map((e) => e.getDuration())).toEqual([30, 30]);

    const view = new View(activity);
    expect(view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)).toBe(true);
    view.setHapticFeedbackEnabled(false);
    expect(view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)).toBe(false);
  });
});

describe('accessibility properties', () => {
  it('stores descriptions and resolves importance through hidden ancestors', () => {
    const { activity } = launch((ctx) => new View(ctx));
    const parent = new FrameLayout(activity);
    const child = new View(activity);
    parent.addView(child, -1, new LayoutParams(10, 10));
    child.setContentDescription('Avatar');
    ViewCompat.setAccessibilityHeading(child, true);
    ViewCompat.setAccessibilityPaneTitle(parent, 'Profile');
    ViewCompat.setAccessibilityLiveRegion(child, ViewCompat.ACCESSIBILITY_LIVE_REGION_POLITE);
    child.setLabelFor(7);
    expect(child.getContentDescription()).toBe('Avatar');
    expect(child.isAccessibilityHeading()).toBe(true);
    expect(parent.getAccessibilityPaneTitle()).toBe('Profile');
    expect(child.getAccessibilityLiveRegion()).toBe(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    expect(child.getLabelFor()).toBe(7);

    expect(child.isImportantForAccessibility()).toBe(true);
    child.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    expect(child.isImportantForAccessibility()).toBe(false);
    child.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    ViewCompat.setImportantForAccessibility(parent, View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
    expect(child.isImportantForAccessibility()).toBe(false);
    expect(parent.isImportantForAccessibility()).toBe(false);
  });

  it('compound buttons describe their state and widgets name their class', () => {
    const { activity } = launch((ctx) => new View(ctx));
    const box = new CheckBox(activity);
    const toggle = new MaterialSwitch(activity);
    expect(box.getStateDescription()).toBe('Not checked');
    box.setChecked(true, false);
    expect(box.getStateDescription()).toBe('Checked');
    expect(toggle.getStateDescription()).toBe('Off');
    ViewCompat.setStateDescription(box, 'Subscribed');
    expect(box.getStateDescription()).toBe('Subscribed');
    expect(box.getAccessibilityClassName()).toBe('android.widget.CheckBox');
    expect(toggle.getAccessibilityClassName()).toBe('android.widget.Switch');
    expect(new TextView(activity).getAccessibilityClassName()).toBe('android.widget.TextView');
    expect(new View(activity).getAccessibilityClassName()).toBe('android.view.View');
  });
});
