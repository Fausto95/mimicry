import { Kernel, type KernelOptions } from '@mimicry/os-core';
import { Android } from '@mimicry/os-android';
import { IOS } from '@mimicry/os-ios';

/**
 * A simulated phone: a kernel booted with the operating system its device
 * descriptor names — iOS for iPhones and iPads, Android for the rest.
 * Framework adapters (React Native today; Lynx, NativeScript, Vector
 * tomorrow) start from here and run on `os`.
 */
export interface SimulatedDevice {
  kernel: Kernel;
  os: IOS | Android;
}

export function bootDevice(options: KernelOptions): SimulatedDevice {
  const kernel = new Kernel(options);
  const os = kernel.env.device.platform === 'ios' ? new IOS(kernel) : new Android(kernel);
  return { kernel, os };
}

export { IOS, Android, Kernel };
