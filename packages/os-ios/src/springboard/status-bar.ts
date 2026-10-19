import type { LayerContext } from '@mimicry/os-core';
import { iosKit } from '../theme';
import { CALayer } from '../quartz-core/ca-layer';
import type { UIApplication } from '../uikit/ui-application';
import { UIView } from '../uikit/ui-view';
import { UIWindowLevel, type UIWindow } from '../uikit/ui-window';

/**
 * The system's status bar and home indicator, drawn by SpringBoard in a
 * window above every app window. Its layer is composited on its own so the
 * raster is reused every frame; it repaints only when the time, the style
 * or the appearance changes.
 */
class StatusBarView extends UIView {
  static override layerClass = CALayer;
  /** returns a forced style, e.g. light content over a page sheet's dark backdrop */
  override_: (() => string | null) | null = null;

  constructor(private readonly application: UIApplication) {
    super(application.screen.bounds);
    this.isUserInteractionEnabled = false;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    const kernel = this.application.kernel;
    const v = kernel.viewport;
    const forced = this.override_?.() ?? this.application._systemStatusBarStyle;
    const bar = forced ? { ...kernel.env.statusBar, barStyle: forced } : kernel.env.statusBar;
    ctx.item({ x: ctx.x, y: ctx.y, w: v.width, h: v.height }, (w) => iosKit.drawChrome(w, v, bar, kernel.env.appearance, kernel.bundledFonts));
  }
}

export class StatusBarWindow {
  readonly window: UIWindow;
  private readonly view: StatusBarView;

  constructor(application: UIApplication) {
    this.window = application.makeWindow();
    this.window.windowLevel = UIWindowLevel.statusBar;
    this.window.isUserInteractionEnabled = false;
    this.window.layer.composited = true;
    this.view = new StatusBarView(application);
    this.window.addSubview(this.view);
    this.window.makeKeyAndVisible();
    application.kernel.env.subscribe(() => {
      this.window.frame = application.screen.bounds;
      this.view.frame = application.screen.bounds;
    });
  }

  /** A style that wins over the app's (UIKit forces light content over dark sheet backdrops). */
  set styleOverride(fn: (() => string | null) | null) {
    this.view.override_ = fn;
  }
}
