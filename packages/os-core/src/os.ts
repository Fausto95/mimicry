import type { PlatformName } from '@mimicry/protocol';
import type { Kernel } from './kernel';
import type { PlatformKit } from './theme/kit';

/**
 * A simulated operating system running on a kernel: iOS (UIKit, Core
 * Animation, Foundation) or Android (the View system, the framework's
 * widgets and app components). Framework adapters — React Native, Lynx,
 * NativeScript, Vector — run on top of one and use its public APIs, the way
 * their native halves use the real ones.
 */
export interface OperatingSystem {
  readonly platform: PlatformName;
  readonly kernel: Kernel;
  /** look-and-feel tables (colors, fonts, control drawing, scroll physics) */
  readonly theme: PlatformKit;
}
