import type { Kernel, OperatingSystem } from '@mimicry/os-core';
import { iosKit } from './theme';
import { StatusBarWindow } from './springboard/status-bar';
import { UIApplication } from './uikit/ui-application';

/**
 * iOS on a kernel: boots UIApplication (screen, windows, touch delivery,
 * the layout pass) and SpringBoard's status bar. Apps then create their
 * windows with `application.makeWindow()`.
 */
export class IOS implements OperatingSystem {
  readonly platform = 'ios' as const;
  readonly theme = iosKit;
  readonly application: UIApplication;
  readonly statusBar: StatusBarWindow;

  constructor(readonly kernel: Kernel) {
    this.application = new UIApplication(kernel);
    this.statusBar = new StatusBarWindow(this.application);
  }
}
