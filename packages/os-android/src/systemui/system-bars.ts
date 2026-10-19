import type { LayerContext } from '@mimicry/os-core';
import { androidKit } from '../theme';
import type { Context } from '../content/context';
import { View } from '../view/view';
import { WindowFlags, WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';

/**
 * SystemUI: the status bar (clock, connectivity, battery) and the gesture
 * navigation handle, in a non-touchable window above the apps. Its layer is
 * composited on its own so the raster is reused every frame.
 */
class SystemBarsView extends View {
  protected override drawContent(ctx: LayerContext): void {
    const kernel = this.context.kernel;
    const v = kernel.viewport;
    ctx.item({ x: ctx.x, y: ctx.y, w: v.width, h: v.height }, (w) => androidKit.drawChrome(w, v, kernel.env.statusBar, kernel.env.appearance, kernel.bundledFonts));
  }
}

export class SystemUI {
  readonly view: View;

  constructor(context: Context, windowManager: WindowManager) {
    this.view = new SystemBarsView(context);
    this.view.renderNode.composited = true;
    windowManager.addView(this.view, new WindowLayoutParams(WindowType.TYPE_STATUS_BAR, WindowFlags.FLAG_NOT_TOUCHABLE | WindowFlags.FLAG_NOT_FOCUSABLE));
  }
}
