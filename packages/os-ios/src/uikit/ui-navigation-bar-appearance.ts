import type { NSAttributes } from '../foundation/ns-attributed-string';
import type { UIColor } from './ui-color';
import type { UIImage } from './ui-image';
import type { UIVisualEffect } from './ui-visual-effect-view';

/**
 * UIBarAppearance / UINavigationBarAppearance (and the tab bar's, which
 * shares the background half). The three configure… presets:
 *
 * - default: iOS 26's scroll-edge effect — content fades out under a soft
 *   wash of the system background, no hairline;
 * - opaque: the system background and a hairline shadow;
 * - transparent: nothing.
 */
export type BarBackgroundKind = 'default' | 'opaque' | 'transparent';

export class UIBarAppearance {
  /** @internal */
  _kind: BarBackgroundKind = 'default';
  backgroundColor: UIColor | null = null;
  backgroundEffect: UIVisualEffect | null = null;
  backgroundImage: UIImage | null = null;
  shadowColor: UIColor | null = null;
  shadowImage: UIImage | null = null;

  configureWithDefaultBackground(): void {
    this._kind = 'default';
    this.backgroundColor = null;
    this.backgroundEffect = null;
    this.shadowColor = null;
  }

  configureWithOpaqueBackground(): void {
    this._kind = 'opaque';
    this.backgroundColor = null;
    this.backgroundEffect = null;
    this.shadowColor = null;
  }

  configureWithTransparentBackground(): void {
    this._kind = 'transparent';
    this.backgroundColor = null;
    this.backgroundEffect = null;
    this.shadowColor = null;
  }
}

export class UINavigationBarAppearance extends UIBarAppearance {
  titleTextAttributes: NSAttributes = {};
  largeTitleTextAttributes: NSAttributes = {};
  titlePositionAdjustment = { horizontal: 0, vertical: 0 };

  constructor(preset: BarBackgroundKind = 'default') {
    super();
    this._kind = preset;
  }

  copy(): UINavigationBarAppearance {
    const c = new UINavigationBarAppearance(this._kind);
    Object.assign(c, this);
    c.titleTextAttributes = { ...this.titleTextAttributes };
    c.largeTitleTextAttributes = { ...this.largeTitleTextAttributes };
    return c;
  }
}
