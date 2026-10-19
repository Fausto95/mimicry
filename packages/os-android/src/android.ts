import type { Kernel, OperatingSystem } from '@mimicry/os-core';
import { androidKit } from './theme';
import { Context } from './content/context';
import { WindowManager } from './view/window-manager';
import { SystemUI } from './systemui/system-bars';

/**
 * Android on a kernel: the window manager (input routing, traversals, back),
 * SystemUI's bars and the application context. Apps start an Activity
 * (`new MyActivity(kernel, android.windowManager).launch()`).
 */
export interface AndroidOptions {
  /** deliver the digitizer's touches through the window manager (default true) */
  routeInput?: boolean;
}

export class Android implements OperatingSystem {
  readonly platform = 'android' as const;
  readonly theme = androidKit;
  readonly windowManager: WindowManager;
  readonly context: Context;
  readonly systemUI: SystemUI;

  constructor(readonly kernel: Kernel, options: AndroidOptions = {}) {
    this.context = new Context(kernel);
    this.windowManager = new WindowManager(kernel, { routeInput: options.routeInput });
    this.systemUI = new SystemUI(this.context, this.windowManager);
    kernel.on('back', () => {
      this.windowManager.back();
    });
  }
}
