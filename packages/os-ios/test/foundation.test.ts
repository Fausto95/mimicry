import { describe, expect, it } from 'vitest';
import {
  Bundle, DispatchQueue, DispatchTime, Notification, NotificationCenter, OperationQueue, ProcessInfo, RunLoop, Timer, UIApplication,
  UIDevice, UIDeviceOrientation, UIDeviceOrientationDidChangeNotification, UIImpactFeedbackGenerator, UIPasteboard, UIScreen,
  UIUserInterfaceIdiom, UserDefaults, UserDefaultsDidChangeNotification,
} from '@mimicry/os-ios';
import { boot } from './helpers';

describe('NotificationCenter', () => {
  it('delivers to matching observers synchronously and stops after removal', () => {
    boot();
    const center = new NotificationCenter();
    const sender = {};
    const got: string[] = [];
    const any = center.addObserver('Ping', null, null, (n) => got.push(`any:${String(n.userInfo?.n)}`));
    const fromSender = center.addObserver('Ping', sender, OperationQueue.main, () => got.push('sender'));
    center.post('Ping', null, { n: 1 });
    center.post(new Notification('Ping', sender, { n: 2 }));
    center.post('Other');
    expect(got).toEqual(['any:1', 'any:2', 'sender']);
    center.removeObserver(any);
    center.removeObserver(fromSender);
    center.post('Ping', sender);
    expect(got.length).toBe(3);
    class Listener {
      count = 0;
      onPing(): void {
        this.count++;
      }
    }
    const listener = new Listener();
    center.addObserverTarget(listener, 'onPing', 'Ping');
    center.post('Ping');
    center.removeObserver(listener);
    center.post('Ping');
    expect(listener.count).toBe(1);
  });
});

describe('UserDefaults', () => {
  it('round-trips property lists on the kernel storage and converts like Foundation', () => {
    const { device } = boot();
    const d = UserDefaults.standard;
    let changes = 0;
    const token = NotificationCenter.default.addObserver(UserDefaultsDidChangeNotification, null, null, () => changes++);
    d.set('hello', 'greeting');
    d.set(42.9, 'answer');
    d.set(true, 'flag');
    d.set(['a', 'b'], 'list');
    d.set({ nested: { n: 1 } }, 'dict');
    d.set(new Uint8Array([1, 2, 255]), 'blob');
    d.set('12', 'numeric');
    expect(d.string('greeting')).toBe('hello');
    expect(d.integer('answer')).toBe(42);
    expect(d.double('answer')).toBe(42.9);
    expect(d.bool('flag')).toBe(true);
    expect(d.stringArray('list')).toEqual(['a', 'b']);
    expect(d.dictionary('dict')).toEqual({ nested: { n: 1 } });
    expect(Array.from(d.data('blob')!)).toEqual([1, 2, 255]);
    expect(d.integer('numeric')).toBe(12);
    expect(d.bool('missing')).toBe(false);
    expect(changes).toBe(7);
    // stored on the kernel, namespaced
    expect(device.kernel.storage.keys('NSUserDefaults:standard').sort()).toContain('greeting');
    d.register({ volume: 0.5, greeting: 'registered' });
    expect(d.double('volume')).toBe(0.5);
    expect(d.string('greeting')).toBe('hello');
    d.removeObject('greeting');
    expect(d.string('greeting')).toBe('registered');
    expect(d.dictionaryRepresentation().volume).toBe(0.5);
    const suite = new UserDefaults('group.shared');
    suite.set(1, 'x');
    expect(device.kernel.storage.get('NSUserDefaults:group.shared', 'x')).toBeDefined();
    expect(d.object('x')).toBeNull();
    NotificationCenter.default.removeObserver(token);
  });
});

describe('Timer and DispatchQueue', () => {
  it('fires on the virtual clock', () => {
    const { device } = boot();
    let ticks = 0;
    const timer = Timer.scheduledTimer(0.5, true, () => ticks++);
    device.advance(1600);
    expect(ticks).toBe(3);
    timer.fire();
    expect(ticks).toBe(4);
    timer.invalidate();
    expect(timer.isValid).toBe(false);
    device.advance(1000);
    expect(ticks).toBe(4);
    let once = 0;
    const single = new Timer(0.2, false, () => once++);
    RunLoop.main.add(single);
    device.advance(500);
    expect(once).toBe(1);
    expect(single.isValid).toBe(false);
  });

  it('runs async work after the current task and asyncAfter at the deadline', () => {
    const { device } = boot();
    const order: string[] = [];
    DispatchQueue.main.async(() => order.push('async'));
    order.push('sync');
    DispatchQueue.main.asyncAfter(DispatchTime.now() + 0.3, () => order.push('later'));
    device.advance(17);
    expect(order).toEqual(['sync', 'async']);
    device.advance(200);
    expect(order).toEqual(['sync', 'async']);
    device.advance(200);
    expect(order).toEqual(['sync', 'async', 'later']);
    expect(DispatchQueue.global().sync(() => 7)).toBe(7);
  });
});

describe('device and app services', () => {
  it('describes the device', () => {
    const { device } = boot();
    const d = UIDevice.current;
    expect(d.name).toBe(device.kernel.viewport.device.name);
    expect(d.model).toBe('iPhone');
    expect(d.systemName).toBe('iOS');
    expect(d.systemVersion).toBe(device.kernel.viewport.device.osVersion);
    expect(d.userInterfaceIdiom).toBe(UIUserInterfaceIdiom.phone);
    expect(d.orientation).toBe(UIDeviceOrientation.portrait);
    expect(d.batteryLevel).toBe(-1);
    d.isBatteryMonitoringEnabled = true;
    expect(d.batteryLevel).toBe(1);
    let rotations = 0;
    d.beginGeneratingDeviceOrientationNotifications();
    const token = NotificationCenter.default.addObserver(UIDeviceOrientationDidChangeNotification, null, null, () => rotations++);
    device.kernel.handle({ type: 'environment', environment: { orientation: 'landscape' } });
    expect(d.orientation).toBe(UIDeviceOrientation.landscapeLeft);
    expect(rotations).toBe(1);
    NotificationCenter.default.removeObserver(token);
    expect(UIScreen.main.scale).toBe(device.kernel.viewport.scale);
    expect(ProcessInfo.processInfo.operatingSystemVersion.majorVersion).toBeGreaterThan(17);
    expect(Bundle.main.object('CFBundleShortVersionString')).toBe('1.0');
  });

  it('keeps a pasteboard, plays haptics and opens URLs', () => {
    const { device } = boot();
    const board = UIPasteboard.general;
    const before = board.changeCount;
    board.string = 'copied';
    expect(board.hasStrings).toBe(true);
    expect(board.string).toBe('copied');
    expect(board.changeCount).toBe(before + 1);
    board.strings = ['a', 'b'];
    expect(board.strings).toEqual(['a', 'b']);
    const haptic = new UIImpactFeedbackGenerator();
    haptic.prepare();
    haptic.impactOccurred();
    expect(haptic._played).toEqual(['impact:medium:1']);
    const app = UIApplication.shared;
    let opened: boolean | null = null;
    app.open('https://apple.com', {}, (ok) => (opened = ok));
    device.advance(17);
    expect(opened).toBe(true);
    expect(device.messages.some((m) => m.type === 'openURL')).toBe(true);
    expect(app.canOpenURL('weird-scheme://x')).toBe(false);
    class Target {
      hits = 0;
      save(): void {
        this.hits++;
      }
    }
    const target = new Target();
    expect(app.sendAction('save', target, null)).toBe(true);
    expect(target.hits).toBe(1);
    expect(app.preferredContentSizeCategory).toBe('UICTContentSizeCategoryL');
  });
});
