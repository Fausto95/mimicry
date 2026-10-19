import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import { RippleDrawable } from '../graphics/drawable';
import { MaterialMotion } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { Gravity } from '../view/gravity';
import { Menu, type MenuItem, type OnMenuItemClickListener } from '../view/menu';
import { MotionEvent } from '../view/motion-event';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { FrameLayout, FrameLayoutParams, LinearLayout, LinearLayoutParams } from '../view/view-group';
import { WindowLayoutParams, WindowType, type WindowManager } from '../view/window-manager';
import { MaterialShapeDrawable } from '../material/shape';
import { TextView } from './text-view';

/**
 * android.widget.PopupMenu (and the toolbar's overflow menu): a menu in a
 * TYPE_APPLICATION_PANEL window anchored to a view, drawn as the Material 3
 * menu — a surfaceContainer panel with 4 dp corners at elevation 3 dp, 112
 * to 280 dp wide, 48 dp BodyLarge items with 12 dp padding. It opens with a
 * 150 ms fade and vertical scale from its top, and closes on an item, a tap
 * outside or back.
 */
class MenuWindowRoot extends FrameLayout {
  constructor(context: Context, private readonly outside: () => void, private readonly panel: () => View) {
    super(context);
  }

  private downOutside = false;

  override onTouchEvent(event: MotionEvent): boolean {
    const p = this.panel();
    const inside = event.getX() >= p.getLeft() && event.getX() < p.getRight() && event.getY() >= p.getTop() && event.getY() < p.getBottom();
    if (event.getActionMasked() === MotionEvent.ACTION_DOWN) {
      this.downOutside = !inside;
      // Like PopupWindow: dismiss as soon as the outside is touched.
      if (this.downOutside) this.outside();
    }
    return true;
  }
}

/** The menu panel never grows past 280 dp or shrinks below 112 dp. */
class MenuPanel extends LinearLayout {
  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    super.onMeasure(MeasureSpec.makeMeasureSpec(280, MeasureSpec.AT_MOST), heightMeasureSpec);
    let widest = 0;
    for (let i = 0; i < this.getChildCount(); i++) widest = Math.max(widest, this.getChildAt(i)!.getMeasuredWidth());
    const width = Math.max(112, Math.min(280, widest));
    super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightMeasureSpec);
  }
}

export class PopupMenu {
  private readonly menu: Menu;
  private listener: OnMenuItemClickListener | null = null;
  private dismissListener: ((menu: PopupMenu) => void) | null = null;
  private root: MenuWindowRoot | null = null;
  private panel: MenuPanel | null = null;
  private gravity: number = Gravity.START | Gravity.TOP;
  /** the toolbar's overflow menu overlaps its anchor; PopupMenu drops below it */
  overlapAnchor = false;

  constructor(private readonly context: Context, private readonly anchor: View, gravity?: number) {
    this.menu = new Menu(context);
    if (gravity !== undefined) this.gravity = gravity;
  }

  getMenu(): Menu {
    return this.menu;
  }

  setGravity(gravity: number): void {
    this.gravity = gravity;
  }

  setOnMenuItemClickListener(listener: OnMenuItemClickListener | null): void {
    this.listener = listener;
  }

  setOnDismissListener(listener: ((menu: PopupMenu) => void) | null): void {
    this.dismissListener = listener;
  }

  isShowing(): boolean {
    return this.root !== null;
  }

  /** @internal the panel (tests) */
  get panelView(): View | null {
    return this.panel;
  }

  show(): void {
    if (this.root) return;
    const context = this.context;
    const theme = context.getTheme();
    const wm = context.getSystemService<WindowManager>('window');
    if (!wm) throw new Error('PopupMenu: no window manager');
    const panel = new MenuPanel(context);
    panel.setOrientation(LinearLayout.VERTICAL);
    panel.setPadding(0, 8, 0, 8);
    const shape = new MaterialShapeDrawable();
    shape.setCornerSize(4);
    shape.setFillColor(ColorStateList.valueOf(theme.getColor('colorSurfaceContainer')));
    panel.setBackground(shape);
    panel.setElevation(3);
    for (const item of this.menu.items()) {
      if (!item.isVisible()) continue;
      panel.addView(this.row(item), -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
    }
    const root = new MenuWindowRoot(context, () => this.dismiss(), () => panel);
    const [ax, ay] = this.anchor.getLocationInWindow();
    const lp = new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
    root.addView(panel, -1, lp);
    // place it once measured: aligned to the anchor's end (or start), over or under it
    const place = () => {
      root.removeOnLayoutChangeListener(place);
      const width = panel.getWidth();
      const end = (Gravity.getAbsoluteGravity(this.gravity) & Gravity.HORIZONTAL_GRAVITY_MASK) === Gravity.RIGHT;
      let left = end ? ax + this.anchor.getWidth() - width : ax;
      left = Math.max(8, Math.min(left, root.getWidth() - width - 8));
      let top = this.overlapAnchor ? ay : ay + this.anchor.getHeight();
      top = Math.max(8, Math.min(top, root.getHeight() - panel.getHeight() - 8));
      lp.leftMargin = left;
      lp.topMargin = top;
      panel.setLayoutParams(lp);
      panel.setPivotX(end ? width : 0);
      panel.setPivotY(0);
    };
    root.addOnLayoutChangeListener(place);
    this.root = root;
    this.panel = panel;
    wm.addView(root, new WindowLayoutParams(WindowType.TYPE_APPLICATION_PANEL), () => {
      this.dismiss();
      return true;
    });
    panel.setAlpha(0);
    panel.setScaleY(0.8);
    const anim = ValueAnimator.ofFloat(0, 1);
    anim.setKernel(context.kernel);
    anim.setDuration(MaterialMotion.duration.short3);
    anim.setInterpolator(MaterialMotion.easing.emphasizedDecelerate);
    anim.addUpdateListener((a) => {
      const f = a.getAnimatedValue() as number;
      panel.setAlpha(f);
      panel.setScaleY(0.8 + 0.2 * f);
    });
    anim.start();
  }

  private row(item: MenuItem): View {
    const theme = this.context.getTheme();
    const text = new TextView(this.context);
    text.setText(item.getTitle());
    text.setTextAppearance(TextAppearance.BodyLarge);
    text.setTextColor(item.isEnabled() ? theme.getColor('colorOnSurface') : withAlphaArgb(theme.getColor('colorOnSurface'), 0.38));
    text.setGravity(Gravity.CENTER_VERTICAL);
    text.setMinimumHeight(48);
    text.setSingleLine(true);
    text.setPadding(12, 0, 12, 0);
    text.setEnabled(item.isEnabled());
    text.setBackground(new RippleDrawable(withAlphaArgb(theme.getColor('colorOnSurface'), 0.1)));
    text.setOnClickListener(() => {
      item.invoke(this.listener);
      this.dismiss();
    });
    return text;
  }

  dismiss(): void {
    const root = this.root;
    if (!root) return;
    this.root = null;
    this.panel = null;
    this.context.getSystemService<WindowManager>('window')?.removeView(root);
    this.dismissListener?.(this);
  }
}
