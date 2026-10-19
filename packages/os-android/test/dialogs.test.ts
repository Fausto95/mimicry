import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, AlertDialog, Color, Dialog, FrameLayout, LayoutParams, MaterialAlertDialogBuilder, TextView, View, WindowType, type LinearLayout,
} from '@mimicry/os-android';

function launch(): { device: Device; activity: Activity } {
  const device = createDevice({ device: 'pixel-9' });
  let activity!: Activity;
  class Main extends Activity {
    protected override onCreate(): void {
      activity = this;
      const root = new FrameLayout(this);
      root.setBackgroundColor(Color.WHITE);
      this.setContentView(root);
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

describe('Dialog', () => {
  it('shows in its own window over a scrim and dismisses with an animation', () => {
    const { device, activity } = launch();
    const dialog = new Dialog(activity);
    const content = new TextView(activity);
    content.setText('Hello');
    content.setBackgroundColor(Color.WHITE);
    dialog.setContentView(content, new LayoutParams(200, 100));
    const log: string[] = [];
    dialog.setOnShowListener(() => log.push('show'));
    dialog.setOnDismissListener(() => log.push('dismiss'));
    dialog.show();
    expect(dialog.isShowing()).toBe(true);
    const wm = device.android.windowManager;
    expect(wm.windows.some((w) => w.params.type === WindowType.TYPE_APPLICATION_ATTACHED_DIALOG)).toBe(true);
    device.advance(300);
    expect(log).toEqual(['show']);
    // the activity shows through the 32% scrim
    const dimmed = rgb(device, 20, 500);
    expect(dimmed[0]!).toBeGreaterThan(160);
    expect(dimmed[0]!).toBeLessThan(180);
    dialog.dismiss();
    device.advance(80);
    expect(log).toEqual(['show']);
    device.advance(150);
    expect(log).toEqual(['show', 'dismiss']);
    expect(dialog.isShowing()).toBe(false);
    expect(wm.windows.some((w) => w.params.type === WindowType.TYPE_APPLICATION_ATTACHED_DIALOG)).toBe(false);
    expect(rgb(device, 20, 500)).toEqual([255, 255, 255]);
  });

  it('back and outside taps cancel a cancelable dialog only', () => {
    const { device, activity } = launch();
    const dialog = new Dialog(activity);
    const content = new View(activity);
    dialog.setContentView(content, new LayoutParams(200, 100));
    let cancels = 0;
    dialog.setOnCancelListener(() => cancels++);
    dialog.show();
    device.advance(300);
    device.tap(...center(content));
    expect(cancels).toBe(0);
    device.tap(20, 800);
    expect(cancels).toBe(1);
    device.advance(300);
    expect(dialog.isShowing()).toBe(false);

    dialog.setCancelable(false);
    dialog.show();
    device.advance(300);
    device.back();
    device.tap(20, 800);
    device.advance(300);
    expect(dialog.isShowing()).toBe(true);
    dialog.setCancelable(true);
    device.back();
    device.advance(300);
    expect(cancels).toBe(2);
    expect(dialog.isShowing()).toBe(false);
  });

  it('setCanceledOnTouchOutside(false) keeps it open on outside taps', () => {
    const { device, activity } = launch();
    const dialog = new Dialog(activity);
    dialog.setContentView(new View(activity), new LayoutParams(100, 100));
    dialog.setCanceledOnTouchOutside(false);
    dialog.show();
    device.advance(300);
    device.tap(20, 800);
    device.advance(300);
    expect(dialog.isShowing()).toBe(true);
  });
});

describe('AlertDialog', () => {
  it('lays out the M3 dialog and dismisses after a button', () => {
    const { device, activity } = launch();
    const clicks: number[] = [];
    const dialog = new MaterialAlertDialogBuilder(activity)
      .setTitle('Discard draft?')
      .setMessage('Your message will be deleted.')
      .setNegativeButton('Cancel', (_d, which) => clicks.push(which))
      .setPositiveButton('Discard', (_d, which) => clicks.push(which))
      .show();
    device.advance(300);
    const panel = dialog.panel!;
    expect(panel.getWidth()).toBe(411 - 48);
    const positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE)!;
    const negative = dialog.getButton(AlertDialog.BUTTON_NEGATIVE)!;
    expect(String(positive.getText())).toBe('Discard');
    // positive is the last button, at the end
    expect(positive.getLeft()).toBeGreaterThan(negative.getLeft());
    const [px] = center(positive);
    expect(px).toBeGreaterThan(300);
    // the panel: surfaceContainerHigh with rounded corners
    const [cx] = center(panel);
    const [, py] = panel.getLocationInWindow();
    expect(rgb(device, cx, py + 8)).toEqual([0xec, 0xe6, 0xf0]);
    device.tap(...center(positive));
    expect(clicks).toEqual([AlertDialog.BUTTON_POSITIVE]);
    device.advance(300);
    expect(dialog.isShowing()).toBe(false);
  });

  it('plain items dismiss, single-choice items do not', () => {
    const { device, activity } = launch();
    const picked: number[] = [];
    const list = new MaterialAlertDialogBuilder(activity).setTitle('Pick').setItems(['A', 'B', 'C'], (_d, which) => picked.push(which)).show();
    device.advance(300);
    const rows = list.getListView()!;
    device.tap(...center(rows.getChildAt(2)!));
    expect(picked).toEqual([2]);
    device.advance(300);
    expect(list.isShowing()).toBe(false);

    const chosen: number[] = [];
    const single = new AlertDialog.Builder(activity)
      .setTitle('Ringtone')
      .setSingleChoiceItems(['Luna', 'Oberon'], 0, (_d, which) => chosen.push(which))
      .setPositiveButton('OK', null)
      .show();
    device.advance(300);
    const options = single.getListView() as LinearLayout;
    device.tap(...center(options.getChildAt(1)!));
    device.advance(300);
    expect(chosen).toEqual([1]);
    expect(single.isShowing()).toBe(true);
    expect((options.getChildAt(0) as unknown as { isChecked(): boolean }).isChecked()).toBe(false);
    expect((options.getChildAt(1) as unknown as { isChecked(): boolean }).isChecked()).toBe(true);
  });

  it('multi-choice items report each toggle', () => {
    const { device, activity } = launch();
    const changes: Array<[number, boolean]> = [];
    const checked = [false, true, false];
    const dialog = new MaterialAlertDialogBuilder(activity)
      .setMultiChoiceItems(['Wi-Fi', 'Bluetooth', 'NFC'], checked, (_d, which, isChecked) => changes.push([which, isChecked]))
      .show();
    device.advance(300);
    const rows = dialog.getListView()!;
    device.tap(...center(rows.getChildAt(0)!));
    device.tap(...center(rows.getChildAt(1)!));
    expect(changes).toEqual([[0, true], [1, false]]);
    expect(checked).toEqual([true, false, false]);
  });
});
