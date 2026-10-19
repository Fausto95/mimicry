import type { Kernel } from '@mimicry/os-core';

/**
 * android.os.ServiceManager: the system services of one device (process),
 * looked up by name through Context.getSystemService — the window manager,
 * clipboard, vibrator… Android registers them when it boots.
 */
const services = new WeakMap<Kernel, Map<string, unknown>>();

export const ServiceManager = {
  addService(kernel: Kernel, name: string, service: unknown): void {
    let map = services.get(kernel);
    if (!map) services.set(kernel, (map = new Map()));
    map.set(name, service);
  },

  getService<T = unknown>(kernel: Kernel, name: string): T | null {
    return (services.get(kernel)?.get(name) as T | undefined) ?? null;
  },
};
