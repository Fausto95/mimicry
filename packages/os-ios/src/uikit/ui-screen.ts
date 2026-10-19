import type { Kernel } from '@mimicry/os-core';
import type { CGRect, UIEdgeInsets } from '../core-graphics/geometry';
import { UITraitCollection } from './ui-trait-collection';

/**
 * UIScreen: the display's bounds in points, its scale, and the traits every
 * window inherits. The safe area is the device's (notch / Dynamic Island,
 * home indicator) for the current orientation.
 */
export class UIScreen {
  private static mainScreen: UIScreen | null = null;
  private traits: UITraitCollection | null = null;
  private version = -1;
  /** 0…1; the simulated display ignores it */
  brightness = 1;
  wantsSoftwareDimming = false;

  /** UIScreen.main (deprecated in iOS 16, still everywhere) */
  static get main(): UIScreen {
    if (!UIScreen.mainScreen) throw new Error('UIScreen.main: no application is running');
    return UIScreen.mainScreen;
  }

  /** @internal the running application's screen */
  static _setMain(screen: UIScreen): void {
    UIScreen.mainScreen = screen;
  }

  constructor(private readonly kernel: Kernel) {}

  get bounds(): CGRect {
    const v = this.kernel.viewport;
    return { origin: { x: 0, y: 0 }, size: { width: v.width, height: v.height } };
  }

  get nativeBounds(): CGRect {
    const v = this.kernel.viewport;
    return { origin: { x: 0, y: 0 }, size: { width: v.width * v.scale, height: v.height * v.scale } };
  }

  get scale(): number {
    return this.kernel.viewport.scale;
  }

  get nativeScale(): number {
    return this.kernel.viewport.scale;
  }

  get safeAreaInsets(): UIEdgeInsets {
    const s = this.kernel.viewport.safeArea;
    return { top: s.top, left: s.left, bottom: s.bottom, right: s.right };
  }

  get traitCollection(): UITraitCollection {
    if (!this.traits || this.version !== this.kernel.env.version) {
      this.traits = UITraitCollection.fromViewport(this.kernel.viewport, this.kernel.env.appearance);
      this.version = this.kernel.env.version;
    }
    return this.traits;
  }

  /** points per frame at the display's refresh rate */
  get maximumFramesPerSecond(): number {
    return 120;
  }
}
