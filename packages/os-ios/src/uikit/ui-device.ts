import type { Kernel } from '@mimicry/os-core';
import { NotificationCenter } from '../foundation/notification-center';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { UIUserInterfaceIdiom } from './ui-trait-collection';

/**
 * UIDevice.current from the device descriptor the kernel runs (name, model,
 * iOS version, idiom, orientation), with UIKit's notifications for
 * orientation and battery changes. The battery is a full one on a charger
 * while monitoring is on (-1 / unknown otherwise, as UIKit reports).
 *
 * Also the haptic feedback generators: they do nothing a screen shows, so
 * they only count what they were asked to play (`_played`) for tests.
 */
export enum UIDeviceOrientation { unknown = 0, portrait = 1, portraitUpsideDown = 2, landscapeLeft = 3, landscapeRight = 4, faceUp = 5, faceDown = 6 }
export enum UIDeviceBatteryState { unknown = 0, unplugged = 1, charging = 2, full = 3 }

export const UIDeviceOrientationDidChangeNotification = 'UIDeviceOrientationDidChangeNotification';
export const UIDeviceBatteryLevelDidChangeNotification = 'UIDeviceBatteryLevelDidChangeNotification';
export const UIDeviceBatteryStateDidChangeNotification = 'UIDeviceBatteryStateDidChangeNotification';

export class UIDevice {
  private static instance: UIDevice | null = null;
  private _batteryMonitoring = false;
  private generating = 0;
  private lastOrientation: UIDeviceOrientation;
  readonly identifierForVendor = 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F';
  isProximityMonitoringEnabled = false;

  private constructor(private readonly kernel: Kernel) {
    this.lastOrientation = this.orientation;
    kernel.env.subscribe(() => {
      const now = this.orientation;
      if (now === this.lastOrientation) return;
      this.lastOrientation = now;
      if (this.generating > 0) NotificationCenter.default.post(UIDeviceOrientationDidChangeNotification, this);
    });
  }

  static get current(): UIDevice {
    const kernel = CAEnvironment.kernel;
    if (!kernel) throw new Error('UIDevice.current: no device is running');
    if (!UIDevice.instance || UIDevice.instance.kernel !== kernel) UIDevice.instance = new UIDevice(kernel);
    return UIDevice.instance;
  }

  private get descriptor() {
    return this.kernel.viewport.device;
  }

  /** the device's name ("iPhone 17 Pro") */
  get name(): string {
    return this.descriptor.name;
  }

  get model(): string {
    return this.descriptor.idiom === 'tablet' ? 'iPad' : 'iPhone';
  }

  get localizedModel(): string {
    return this.model;
  }

  get systemName(): string {
    return this.descriptor.idiom === 'tablet' ? 'iPadOS' : 'iOS';
  }

  get systemVersion(): string {
    return this.descriptor.osVersion;
  }

  get userInterfaceIdiom(): UIUserInterfaceIdiom {
    return this.descriptor.idiom === 'tablet' ? UIUserInterfaceIdiom.pad : UIUserInterfaceIdiom.phone;
  }

  get orientation(): UIDeviceOrientation {
    return this.kernel.env.orientation === 'landscape' ? UIDeviceOrientation.landscapeLeft : UIDeviceOrientation.portrait;
  }

  get isGeneratingDeviceOrientationNotifications(): boolean {
    return this.generating > 0;
  }

  beginGeneratingDeviceOrientationNotifications(): void {
    this.generating++;
  }

  endGeneratingDeviceOrientationNotifications(): void {
    this.generating = Math.max(0, this.generating - 1);
  }

  get isBatteryMonitoringEnabled(): boolean {
    return this._batteryMonitoring;
  }

  set isBatteryMonitoringEnabled(enabled: boolean) {
    if (enabled === this._batteryMonitoring) return;
    this._batteryMonitoring = enabled;
    NotificationCenter.default.post(UIDeviceBatteryStateDidChangeNotification, this);
    NotificationCenter.default.post(UIDeviceBatteryLevelDidChangeNotification, this);
  }

  /** 0…1, or -1 when monitoring is off */
  get batteryLevel(): number {
    return this._batteryMonitoring ? 1 : -1;
  }

  get batteryState(): UIDeviceBatteryState {
    return this._batteryMonitoring ? UIDeviceBatteryState.full : UIDeviceBatteryState.unknown;
  }

  get isMultitaskingSupported(): boolean {
    return true;
  }

  playInputClick(): void {}
}

// ── haptics ──────────────────────────────────────────────────────────────

export enum UIImpactFeedbackStyle { light = 0, medium = 1, heavy = 2, soft = 3, rigid = 4 }
export enum UINotificationFeedbackType { success = 0, warning = 1, error = 2 }

export abstract class UIFeedbackGenerator {
  /** @internal what was played, newest last (tests) */
  readonly _played: string[] = [];
  prepare(): void {}
}

export class UIImpactFeedbackGenerator extends UIFeedbackGenerator {
  constructor(readonly style: UIImpactFeedbackStyle = UIImpactFeedbackStyle.medium) {
    super();
  }

  impactOccurred(intensity = 1): void {
    this._played.push(`impact:${UIImpactFeedbackStyle[this.style]}:${intensity}`);
  }
}

export class UISelectionFeedbackGenerator extends UIFeedbackGenerator {
  selectionChanged(): void {
    this._played.push('selection');
  }
}

export class UINotificationFeedbackGenerator extends UIFeedbackGenerator {
  notificationOccurred(type: UINotificationFeedbackType): void {
    this._played.push(`notification:${UINotificationFeedbackType[type]}`);
  }
}
