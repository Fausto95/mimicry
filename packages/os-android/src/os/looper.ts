import type { Kernel } from '@mimicry/os-core';

/**
 * android.os.Looper's main looper, reduced to what static framework APIs
 * need: the kernel of the process they run in. Each simulated device is a
 * process; the most recently booted Android is the "current" one for APIs
 * that take no Context (ValueAnimator.ofFloat, AppCompatDelegate,
 * Toast.makeText without a view…), like the framework's thread-locals.
 */
let mainKernel: Kernel | null = null;

export const Looper = {
  /** @internal set when Android boots */
  prepareMainLooper(kernel: Kernel | null): void {
    mainKernel = kernel;
  },

  getMainKernel(): Kernel | null {
    return mainKernel;
  },

  /** The main kernel, or an error like the framework's "Can't create handler inside thread that has not called Looper.prepare()". */
  requireMainKernel(): Kernel {
    if (!mainKernel) throw new Error('RuntimeException: no Looper (no Android has booted)');
    return mainKernel;
  },
};
