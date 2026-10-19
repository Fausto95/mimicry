import { describe, expect, it } from 'vitest';
import {
  CGRectMake, UIAlertAction, UIAlertActionStyle, UIAlertController, UIAlertControllerStyle, UIColor, UILabel, UIViewController,
} from '@mimicry/os-ios';
import { boot, saveArtifact } from './helpers';

function scene() {
  const env = boot();
  const root = new UIViewController();
  root.view.backgroundColor = UIColor.systemGroupedBackground;
  const label = new UILabel(CGRectMake(20, 100, 360, 40));
  label.text = 'Messages';
  label.font = label.font.withSize(34);
  root.view.addSubview(label);
  env.window.rootViewController = root;
  env.device.advance(17);
  return { ...env, root };
}

describe('UIAlertController', () => {
  it('lays out an alert with two actions side by side, cancel on the left', () => {
    const { device, root } = scene();
    const tapped: string[] = [];
    const alert = new UIAlertController('Delete Message?', 'This message will be deleted from all your devices.', UIAlertControllerStyle.alert);
    alert.addAction(new UIAlertAction('Delete', UIAlertActionStyle.destructive, (a) => tapped.push(a.title!)));
    alert.addAction(new UIAlertAction('Cancel', UIAlertActionStyle.cancel, (a) => tapped.push(a.title!)));
    expect(() => alert.addAction(new UIAlertAction('Again', UIAlertActionStyle.cancel))).toThrow();
    root.present(alert, true);
    device.advance(60);
    const opacity = alert.view.layer.presentation().opacity;
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    device.settle();
    const f = alert.view.frame;
    expect(f.size.width).toBe(270);
    expect(f.origin.x).toBe((402 - 270) / 2);
    saveArtifact('alert.png', device.screenshot());
    // the left half of the button row is Cancel
    device.tap(f.origin.x + 60, f.origin.y + f.size.height - 22);
    expect(tapped).toEqual([]); // handlers run after the dismissal
    device.settle();
    expect(tapped).toEqual(['Cancel']);
    expect(root.presentedViewController).toBeNull();
  });

  it('stacks three or more actions with cancel last, and draws text fields', () => {
    const { device, root } = scene();
    const alert = new UIAlertController('Sign In', null, UIAlertControllerStyle.alert);
    alert.addTextField((f) => (f.placeholder = 'Email'));
    alert.addTextField((f) => {
      f.placeholder = 'Password';
      f.isSecureTextEntry = true;
    });
    alert.addAction(new UIAlertAction('Cancel', UIAlertActionStyle.cancel));
    alert.addAction(new UIAlertAction('Sign In'));
    alert.addAction(new UIAlertAction('Forgot Password'));
    alert.preferredAction = alert.actions[1]!;
    root.present(alert, false);
    device.settle();
    expect(alert.textFields?.length).toBe(2);
    expect(alert.view.frame.size.height).toBeGreaterThan(44 * 3 + 48);
    saveArtifact('alert-stacked.png', device.screenshot());
  });

  it('presents an action sheet from the bottom; tapping outside cancels', () => {
    const { device, root } = scene();
    let cancelled = false;
    const sheet = new UIAlertController('Photo', 'Choose a source', UIAlertControllerStyle.actionSheet);
    sheet.addAction(new UIAlertAction('Take Photo'));
    sheet.addAction(new UIAlertAction('Choose from Library'));
    sheet.addAction(new UIAlertAction('Remove Photo', UIAlertActionStyle.destructive));
    sheet.addAction(new UIAlertAction('Cancel', UIAlertActionStyle.cancel, () => (cancelled = true)));
    root.present(sheet, true);
    device.settle();
    const f = sheet.view.frame;
    expect(f.origin.x).toBe(8);
    expect(f.origin.y + f.size.height).toBeCloseTo(874 - 34, 0);
    saveArtifact('action-sheet.png', device.screenshot());
    device.tap(200, 150);
    device.settle();
    expect(cancelled).toBe(true);
    expect(root.presentedViewController).toBeNull();
  });
});
