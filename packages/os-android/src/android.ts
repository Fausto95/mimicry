import type { Kernel, OperatingSystem } from '@mimicry/os-core';
import { androidKit } from './theme';
import { Context } from './content/context';
import { WindowManager } from './view/window-manager';
import { SystemUI } from './systemui/system-bars';
import { AnimationHandler } from './animation/value-animator';
import { ServiceManager } from './os/service-manager';
import { ClipboardManager } from './content/clipboard';
import { Vibrator, VibratorManager } from './os/vibrator';
import { KernelPreferenceStore, SharedPreferencesImpl, type SharedPreferences } from './content/shared-preferences';

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
    // The main looper: animators created without a view run here.
    AnimationHandler.setMainKernel(kernel);
    // SharedPreferences files are shared by every Context of the process, kept in the kernel's storage.
    Context.preferencesFactory = preferencesFactory;
    this.context = new Context(kernel);
    this.windowManager = new WindowManager(kernel, { routeInput: options.routeInput });
    ServiceManager.addService(kernel, Context.WINDOW_SERVICE, this.windowManager);
    const vibrator = new Vibrator();
    ServiceManager.addService(kernel, Context.VIBRATOR_SERVICE, vibrator);
    ServiceManager.addService(kernel, Context.VIBRATOR_MANAGER_SERVICE, new VibratorManager(vibrator));
    ServiceManager.addService(kernel, Context.CLIPBOARD_SERVICE, new ClipboardManager());
    this.systemUI = new SystemUI(this.context, this.windowManager);
    kernel.on('back', () => {
      this.windowManager.back();
    });
  }
}

const preferenceFiles = new WeakMap<Kernel, Map<string, SharedPreferences>>();

function preferencesFactory(kernel: Kernel, name: string): SharedPreferences {
  let files = preferenceFiles.get(kernel);
  if (!files) preferenceFiles.set(kernel, (files = new Map()));
  let prefs = files.get(name);
  if (!prefs) files.set(name, (prefs = new SharedPreferencesImpl(name, new KernelPreferenceStore(kernel))));
  return prefs;
}
