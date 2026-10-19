import type { Kernel, OperatingSystem } from '@mimicry/os-core';
import { iosKit } from './theme';
import { StatusBarWindow } from './springboard/status-bar';
import { UIApplication } from './uikit/ui-application';

/**
 * iOS on a kernel: boots UIApplication (screen, windows, touch delivery,
 * the layout pass) and SpringBoard's status bar. Apps then create their
 * windows with `application.makeWindow()`.
 */
export interface IOSOptions {
  /** deliver the digitizer's touches through UIKit (default true) */
  routeInput?: boolean;
}

export class IOS implements OperatingSystem {
  readonly platform = 'ios' as const;
  readonly theme = iosKit;
  readonly application: UIApplication;
  readonly statusBar: StatusBarWindow;

  constructor(readonly kernel: Kernel, options: IOSOptions = {}) {
    this.application = new UIApplication(kernel, { routeInput: options.routeInput });
    this.statusBar = new StatusBarWindow(this.application);
  }
}
