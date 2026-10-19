import type { Appearance } from '@mimicry/protocol';
import type { LayerContext, StatusBarState } from '@mimicry/os-core';
import { drawNavigationHandle, drawStatusBar } from '../theme';
import type { Context } from '../content/context';
import { View } from '../view/view';
import { WindowFlags, WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';
import { WindowInsetsType } from '../view/window-insets';
import { PhoneWindow, WindowInsetsController } from '../app/activity';

/**
 * SystemUI: the status bar (clock, connectivity, battery) and the gesture
 * navigation handle, in a non-touchable window above the apps. Its layer is
 * composited on its own so the raster is reused every frame.
 *
 * The bars follow the top application window's WindowInsetsController: its
 * light-status-bar / light-navigation-bar appearance picks the icon and
 * handle colors, and hidden bars are not drawn. A window that never set an
 * appearance leaves the status bar to the state frameworks set on the
 * kernel (React Native's StatusBar) and the handle to the system theme.
 */
interface BarsStyle {
  statusBar: StatusBarState;
  statusAppearance: Appearance;
  navigationAppearance: Appearance;
  navigationHidden: boolean;
}

class SystemBarsView extends View {
  constructor(context: Context, private readonly windowManager: WindowManager) {
    super(context);
  }

  /** The top application window's choices, over the kernel's status bar state. */
  private style(): BarsStyle {
    const kernel = this.context.kernel;
    const style: BarsStyle = {
      statusBar: kernel.env.statusBar,
      statusAppearance: kernel.env.appearance,
      navigationAppearance: kernel.env.appearance,
      navigationHidden: false,
    };
    const top = this.windowManager.windows
      .filter((w) => w.params.type >= WindowType.TYPE_BASE_APPLICATION && w.params.type < 2000)
      .map((w) => PhoneWindow.forDecorView(w.view))
      .filter((w): w is PhoneWindow => w !== null)
      .pop();
    if (!top) return style;
    const controller = top.getInsetsController();
    const mask = controller.getAppearanceMask();
    const appearance = controller.getSystemBarsAppearance();
    const hidden = controller.getHiddenTypes();
    if (mask & WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) {
      const light = (appearance & WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) !== 0;
      style.statusBar = { ...style.statusBar, barStyle: light ? 'dark-content' : 'light-content' };
    }
    if (hidden & WindowInsetsType.statusBars()) style.statusBar = { ...style.statusBar, hidden: true };
    if (mask & WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS) {
      // light navigation bars draw a dark handle, as on light content
      style.navigationAppearance = appearance & WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS ? 'light' : 'dark';
    }
    style.navigationHidden = (hidden & WindowInsetsType.navigationBars()) !== 0;
    return style;
  }

  protected override drawContent(ctx: LayerContext): void {
    const kernel = this.context.kernel;
    const v = kernel.viewport;
    const s = this.style();
    ctx.item({ x: ctx.x, y: ctx.y, w: v.width, h: v.height }, (w) => {
      drawStatusBar(w, v, s.statusBar, s.statusAppearance);
      if (!s.navigationHidden) drawNavigationHandle(w, v, s.navigationAppearance);
    });
  }
}

export class SystemUI {
  readonly view: View;

  constructor(context: Context, windowManager: WindowManager) {
    this.view = new SystemBarsView(context, windowManager);
    this.view.renderNode.composited = true;
    windowManager.addView(this.view, new WindowLayoutParams(WindowType.TYPE_STATUS_BAR, WindowFlags.FLAG_NOT_TOUCHABLE | WindowFlags.FLAG_NOT_FOCUSABLE));
  }
}
