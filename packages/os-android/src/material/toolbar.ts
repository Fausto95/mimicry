import type { Context } from '../content/context';
import { TextAppearance } from '../content/theme';
import type { Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Gravity } from '../view/gravity';
import { Menu, MenuItem, type MenuSpec, type OnMenuItemClickListener } from '../view/menu';
import { LayoutParams, MeasureSpec, View } from '../view/view';
import { ViewGroup, marginsOf } from '../view/view-group';
import { TruncateAt } from '../text/static-layout';
import type { CharSequence } from '../text/spanned';
import { PopupMenu } from '../widget/popup-menu';
import { TextView } from '../widget/text-view';
import { ImageButton } from './button';

/**
 * androidx.appcompat.widget.Toolbar and
 * com.google.android.material.appbar.MaterialToolbar — the Material 3 small
 * top app bar: 64 dp tall (transparent: the AppBarLayout or window under it
 * is the surface; Widget.Material3.Toolbar.Surface adds colorSurface), a 48 dp navigation button 4 dp
 * from the start (icon in onSurface), the TitleLarge title 16 dp from the
 * start (72 dp after a navigation icon, the contentInsetStartWithNavigation
 * React Native's header was tuned to), optional subtitle, then action
 * buttons (onSurfaceVariant icons) and the overflow button at the end.
 *
 * Menu items with SHOW_AS_ACTION_ALWAYS are buttons; IF_ROOM ones too as
 * long as the action bar policy allows (3 slots under 500 dp of width, 4
 * under 600, 5 above); the rest go into the overflow popup menu. Custom
 * child views sit between the title and the actions.
 */
export class Toolbar extends ViewGroup {
  private readonly titleView: TextView;
  private readonly subtitleView: TextView;
  private navButton: ImageButton | null = null;
  private navListener: ((view: View) => void) | null = null;
  private readonly menu: Menu;
  private menuListener: OnMenuItemClickListener | null = null;
  private actionButtons: ImageButton[] = [];
  private overflowButton: ImageButton | null = null;
  private overflowItems: MenuItem[] = [];
  private overflowMenu: PopupMenu | null = null;
  private titleCentered = false;
  private contentInsetStart = 16;
  private contentInsetStartWithNavigation = 72;
  private readonly customViews: View[] = [];

  constructor(context: Context) {
    super(context);
    const theme = context.getTheme();
    // Widget.Material3.Toolbar has no background: the AppBarLayout (or window) is the surface.
    this.setMinimumHeight(64);
    this.titleView = new TextView(context);
    this.titleView.setTextAppearance(TextAppearance.TitleLarge);
    this.titleView.setTextColor(theme.getColor('colorOnSurface'));
    this.titleView.setSingleLine(true);
    this.titleView.setEllipsize(TruncateAt.END);
    this.titleView.setVisibility(View.GONE);
    this.subtitleView = new TextView(context);
    this.subtitleView.setTextAppearance(TextAppearance.BodyMedium);
    this.subtitleView.setTextColor(theme.getColor('colorOnSurfaceVariant'));
    this.subtitleView.setSingleLine(true);
    this.subtitleView.setEllipsize(TruncateAt.END);
    this.subtitleView.setVisibility(View.GONE);
    super.addView(this.titleView);
    super.addView(this.subtitleView);
    this.menu = new Menu(context);
    this.menu.onChanged(() => this.rebuildActions());
  }

  // ── title ───────────────────────────────────────────────────────────

  setTitle(title: CharSequence | null): void {
    this.titleView.setText(title);
    this.titleView.setVisibility(title ? View.VISIBLE : View.GONE);
    this.requestLayout();
  }

  getTitle(): CharSequence {
    return this.titleView.getText();
  }

  setSubtitle(subtitle: CharSequence | null): void {
    this.subtitleView.setText(subtitle);
    this.subtitleView.setVisibility(subtitle ? View.VISIBLE : View.GONE);
    this.requestLayout();
  }

  getSubtitle(): CharSequence {
    return this.subtitleView.getText();
  }

  setTitleTextColor(color: number): void {
    this.titleView.setTextColor(color);
  }

  setSubtitleTextColor(color: number): void {
    this.subtitleView.setTextColor(color);
  }

  /** MaterialToolbar.setTitleCentered */
  setTitleCentered(centered: boolean): void {
    this.titleCentered = centered;
    this.requestLayout();
  }

  isTitleCentered(): boolean {
    return this.titleCentered;
  }

  setContentInsetsRelative(start: number, _end: number): void {
    this.contentInsetStart = start;
    this.requestLayout();
  }

  setContentInsetStartWithNavigation(inset: number): void {
    this.contentInsetStartWithNavigation = inset;
    this.requestLayout();
  }

  /** @internal the title view (tests, app bars) */
  get titleTextView(): TextView {
    return this.titleView;
  }

  // ── navigation ──────────────────────────────────────────────────────

  /** A drawable or a Material Symbols name ('arrow_back', 'menu', 'close'); null removes it. */
  setNavigationIcon(icon: Drawable | string | null): void {
    if (!icon) {
      if (this.navButton) super.removeView(this.navButton);
      this.navButton = null;
      this.requestLayout();
      return;
    }
    if (!this.navButton) {
      this.navButton = new ImageButton(this.context);
      this.navButton.setContentDescription('Navigate up');
      this.navButton.setOnClickListener((v) => this.navListener?.(v));
      super.addView(this.navButton);
    }
    const drawable = typeof icon === 'string' ? new MaterialIconDrawable(this.context, icon) : icon;
    drawable.setTint(this.context.getTheme().getColor('colorOnSurface'));
    this.navButton.setImageDrawable(drawable);
    this.requestLayout();
  }

  getNavigationIcon(): Drawable | null {
    return this.navButton?.getDrawable() ?? null;
  }

  setNavigationOnClickListener(listener: ((view: View) => void) | null): void {
    this.navListener = listener;
  }

  setNavigationContentDescription(description: string | null): void {
    this.navButton?.setContentDescription(description);
  }

  /** @internal */
  get navigationButton(): ImageButton | null {
    return this.navButton;
  }

  // ── menu ────────────────────────────────────────────────────────────

  getMenu(): Menu {
    return this.menu;
  }

  /** Toolbar.inflateMenu, with the menu resource given as data. */
  inflateMenu(specs: readonly MenuSpec[]): void {
    this.menu.inflate(specs);
  }

  setOnMenuItemClickListener(listener: OnMenuItemClickListener | null): void {
    this.menuListener = listener;
  }

  showOverflowMenu(): boolean {
    if (!this.overflowButton) return false;
    this.overflowMenu?.dismiss();
    const popup = new PopupMenu(this.context, this.overflowButton, Gravity.END);
    popup.overlapAnchor = true;
    for (const item of this.overflowItems) {
      const copy = popup.getMenu().add(item.getGroupId(), item.getItemId(), item.getOrder(), item.getTitle());
      copy.setEnabled(item.isEnabled());
    }
    popup.setOnMenuItemClickListener((copy) => {
      const original = this.menu.findItem(copy.getItemId());
      return original ? original.invoke(this.menuListener) : false;
    });
    popup.setOnDismissListener(() => {
      if (this.overflowMenu === popup) this.overflowMenu = null;
    });
    this.overflowMenu = popup;
    popup.show();
    return true;
  }

  hideOverflowMenu(): boolean {
    if (!this.overflowMenu) return false;
    this.overflowMenu.dismiss();
    return true;
  }

  isOverflowMenuShowing(): boolean {
    return !!this.overflowMenu?.isShowing();
  }

  /** @internal */
  get overflowPopup(): PopupMenu | null {
    return this.overflowMenu;
  }

  /** ActionBarPolicy.getMaxActionButtons by width */
  private maxActionButtons(): number {
    const width = this.context.getResources().getConfiguration().screenWidthDp;
    if (width >= 600) return 5;
    if (width >= 500) return 4;
    return 3;
  }

  private rebuildActions(): void {
    for (const b of this.actionButtons) super.removeView(b);
    if (this.overflowButton) super.removeView(this.overflowButton);
    this.actionButtons = [];
    this.overflowButton = null;
    const visible = this.menu.items().filter((i) => i.isVisible());
    const always = visible.filter((i) => i.getShowAsAction() & MenuItem.SHOW_AS_ACTION_ALWAYS);
    const ifRoom = visible.filter((i) => !(i.getShowAsAction() & MenuItem.SHOW_AS_ACTION_ALWAYS) && i.getShowAsAction() & MenuItem.SHOW_AS_ACTION_IF_ROOM);
    const never = visible.filter((i) => !(i.getShowAsAction() & (MenuItem.SHOW_AS_ACTION_ALWAYS | MenuItem.SHOW_AS_ACTION_IF_ROOM)));
    let slots = this.maxActionButtons() - always.length;
    const shown = new Set(always);
    const overflow = never.slice();
    for (const item of ifRoom) {
      // the last slot goes to the overflow button if anything is left over
      const leftOver = overflow.length + ifRoom.filter((i) => !shown.has(i) && i !== item).length;
      if (slots > (leftOver > 0 ? 1 : 0)) {
        shown.add(item);
        slots--;
      } else overflow.push(item);
    }
    const theme = this.context.getTheme();
    for (const item of visible.filter((i) => shown.has(i))) {
      const b = new ImageButton(this.context);
      const icon = item.getIcon();
      if (icon) {
        icon.setTint(theme.getColor('colorOnSurfaceVariant'));
        b.setImageDrawable(icon);
      }
      b.setContentDescription(item.getContentDescription() ?? item.getTitle());
      b.setEnabled(item.isEnabled());
      b.setOnClickListener(() => item.invoke(this.menuListener));
      this.actionButtons.push(b);
      super.addView(b);
    }
    this.overflowItems = overflow.sort((a, b) => a.getOrder() - b.getOrder() || visible.indexOf(a) - visible.indexOf(b));
    if (this.overflowItems.length) {
      const b = new ImageButton(this.context);
      b.setImageDrawable(new MaterialIconDrawable(this.context, 'more_vert', 24, theme.getColor('colorOnSurfaceVariant')));
      b.setContentDescription('More options');
      b.setOnClickListener(() => this.showOverflowMenu());
      this.overflowButton = b;
      super.addView(b);
    }
    this.requestLayout();
  }

  /** @internal the action buttons, in order */
  get actionViews(): readonly ImageButton[] {
    return this.actionButtons;
  }

  /** @internal */
  get overflowView(): ImageButton | null {
    return this.overflowButton;
  }

  // ── custom views ────────────────────────────────────────────────────

  override addView(child: View, index = -1, params?: LayoutParams): void {
    this.customViews.push(child);
    super.addView(child, index, params);
  }

  override removeView(child: View): void {
    const at = this.customViews.indexOf(child);
    if (at >= 0) this.customViews.splice(at, 1);
    super.removeView(child);
  }

  // ── measure & layout ────────────────────────────────────────────────

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const width = View.getDefaultSize(this.getSuggestedMinimumWidth(), widthMeasureSpec);
    const exactly = (n: number) => MeasureSpec.makeMeasureSpec(n, MeasureSpec.EXACTLY);
    const unspecified = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED);
    for (const b of [this.navButton, ...this.actionButtons, this.overflowButton]) b?.measure(exactly(48), exactly(48));
    const sideButtons = this.actionButtons.length + (this.overflowButton ? 1 : 0);
    const start = this.navButton ? this.contentInsetStartWithNavigation : this.contentInsetStart;
    const endSpace = sideButtons ? sideButtons * 48 + 4 : 16;
    const available = Math.max(0, width - start - endSpace);
    let customWidth = 0;
    for (const v of this.customViews) {
      if (v.getVisibility() === View.GONE) continue;
      const lp = v.getLayoutParams() ?? new LayoutParams();
      v.measure(ViewGroup.getChildMeasureSpec(MeasureSpec.makeMeasureSpec(available, MeasureSpec.AT_MOST), 0, lp.width), ViewGroup.getChildMeasureSpec(exactly(64), 0, lp.height));
      customWidth += v.getMeasuredWidth();
    }
    const titleSpace = Math.max(0, available - customWidth);
    this.titleView.measure(MeasureSpec.makeMeasureSpec(titleSpace, MeasureSpec.AT_MOST), unspecified);
    this.subtitleView.measure(MeasureSpec.makeMeasureSpec(titleSpace, MeasureSpec.AT_MOST), unspecified);
    const height = View.resolveSize(Math.max(64, this.getSuggestedMinimumHeight()) + this.getPaddingTop() + this.getPaddingBottom(), heightMeasureSpec);
    this.setMeasuredDimension(width, height);
  }

  protected override onLayout(_changed: boolean, l: number, t: number, r: number, b: number): void {
    const width = r - l;
    const top = this.getPaddingTop();
    const barHeight = b - t - this.getPaddingTop() - this.getPaddingBottom();
    const centerY = top + barHeight / 2;
    const place = (v: View, x: number) => v.layout(x, centerY - v.getMeasuredHeight() / 2, x + v.getMeasuredWidth(), centerY + v.getMeasuredHeight() / 2);
    if (this.navButton) place(this.navButton, 4);
    let x = width - 4;
    if (this.overflowButton) {
      x -= 48;
      place(this.overflowButton, x);
    }
    for (let i = this.actionButtons.length - 1; i >= 0; i--) {
      x -= 48;
      place(this.actionButtons[i]!, x);
    }
    const start = this.navButton ? this.contentInsetStartWithNavigation : this.contentInsetStart;
    const title = this.titleView.getVisibility() !== View.GONE ? this.titleView : null;
    const subtitle = this.subtitleView.getVisibility() !== View.GONE ? this.subtitleView : null;
    const stack = (title?.getMeasuredHeight() ?? 0) + (subtitle?.getMeasuredHeight() ?? 0);
    let y = centerY - stack / 2;
    const titleX = (v: View) => (this.titleCentered ? (width - v.getMeasuredWidth()) / 2 : start);
    if (title) {
      title.layout(titleX(title), y, titleX(title) + title.getMeasuredWidth(), y + title.getMeasuredHeight());
      y += title.getMeasuredHeight();
    }
    if (subtitle) subtitle.layout(titleX(subtitle), y, titleX(subtitle) + subtitle.getMeasuredWidth(), y + subtitle.getMeasuredHeight());
    let cx = start + (this.titleCentered ? 0 : Math.max(title?.getMeasuredWidth() ?? 0, subtitle?.getMeasuredWidth() ?? 0));
    for (const v of this.customViews) {
      if (v.getVisibility() === View.GONE) continue;
      const m = marginsOf(v.getLayoutParams());
      cx += m.left;
      place(v, cx);
      cx += v.getMeasuredWidth() + m.right;
    }
  }
}

export class MaterialToolbar extends Toolbar {}
