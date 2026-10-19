import type { Context } from '../content/context';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { Color } from '../graphics/color';
import { RippleDrawable } from '../graphics/drawable';
import { MaterialMotion } from '../animation/interpolators';
import { ValueAnimator } from '../animation/value-animator';
import { Typeface } from '../text/typeface';
import { Menu, MenuItem, type MenuSpec } from '../view/menu';
import { MeasureSpec, View } from '../view/view';
import { ViewGroup } from '../view/view-group';
import { WindowInsetsType, type WindowInsets } from '../view/window-insets';

/**
 * com.google.android.material.bottomnavigation.BottomNavigationView
 * (NavigationBarView), Material 3: an 80 dp bar on surfaceContainer, padded
 * by the navigation bar inset, with up to five items — a 24 dp icon in a
 * 56 × 32 active-indicator pill (secondaryContainer) that grows in when an
 * item is selected, and a LabelMedium label (bold when active). Badges are
 * a 6 dp dot or a 16 dp numbered pill in colorError at the icon's top end.
 *
 * The metrics are the ones React Native's Android tab bar was matched to
 * against emulator screenshots.
 */
export const LabelVisibility = {
  AUTO: -1,
  SELECTED: 0,
  LABELED: 1,
  UNLABELED: 2,
} as const;

const BAR_HEIGHT = 80;
const INDICATOR = { width: 56, height: 32, top: 12 };

/** com.google.android.material.badge.BadgeDrawable */
export class BadgeDrawable {
  private number = -1;
  private visible = true;
  private maxCharacterCount = 4;
  private background: number;
  private textColor: number;

  constructor(private readonly owner: View) {
    const theme = owner.context.getTheme();
    this.background = theme.getColor('colorError');
    this.textColor = theme.getColor('colorOnError');
  }

  setNumber(n: number): void {
    this.number = Math.max(0, n);
    this.owner.invalidate();
  }

  getNumber(): number {
    return Math.max(0, this.number);
  }

  hasNumber(): boolean {
    return this.number >= 0;
  }

  clearNumber(): void {
    this.number = -1;
    this.owner.invalidate();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.owner.invalidate();
  }

  isVisible(): boolean {
    return this.visible;
  }

  setMaxCharacterCount(count: number): void {
    this.maxCharacterCount = count;
    this.owner.invalidate();
  }

  setBackgroundColor(color: number): void {
    this.background = color;
    this.owner.invalidate();
  }

  setBadgeTextColor(color: number): void {
    this.textColor = color;
    this.owner.invalidate();
  }

  /** "99+"-style text for the number, or null for a dot. */
  text(): string | null {
    if (this.number < 0) return null;
    const max = Math.pow(10, this.maxCharacterCount - 1) - 1;
    return this.number > max ? `${max}+` : String(this.number);
  }

  /** Draw anchored to an icon's top-end corner at (x, y). */
  draw(canvas: Canvas, x: number, y: number): void {
    if (!this.visible) return;
    const w = canvas.writer;
    const text = this.text();
    if (text === null) {
      w.pathBegin().arc(x + 1, y + 3, 3, 0, Math.PI * 2).closePath().fillPath(Color.toRgba(this.background));
      return;
    }
    const font = Typeface.create('sans-serif-medium', Typeface.NORMAL).css(TextAppearance.LabelSmall.size);
    const textWidth = this.owner.context.kernel.measurer.width(text, font, 0);
    const width = Math.max(16, textWidth + 8);
    const left = x - 4;
    const top = y - 2;
    w.fillRRect(left, top, width, 16, [8, 8, 8, 8], Color.toRgba(this.background));
    w.font(font);
    w.text(left + (width - textWidth) / 2, top + 12, Color.toRgba(this.textColor), 0, text);
  }
}

class NavigationBarItemView extends View {
  /** 0 → 1 as the item becomes active */
  activeProgress = 0;
  badge: BadgeDrawable | null = null;
  private readonly ripple: RippleDrawable;

  constructor(context: Context, readonly item: MenuItem, private readonly bar: NavigationBarView) {
    super(context);
    this.setClickable(true);
    this.setFocusable(true);
    // the state layer covers the indicator, not the whole item
    this.ripple = new RippleDrawable(withAlphaArgb(context.getTheme().getColor('colorOnSurface'), 0.1));
    this.ripple.maskRadii = [16, 16, 16, 16];
    this.ripple.setCallback(this);
    this.setContentDescription(item.getContentDescription() ?? item.getTitle());
  }

  override drawableHotspotChanged(_x: number, _y: number): void {
    this.ripple.setHotspot(INDICATOR.width / 2, INDICATOR.height / 2);
  }

  protected override drawableStateChanged(): void {
    super.drawableStateChanged();
    const left = (this.getWidth() - INDICATOR.width) / 2;
    this.ripple.setBounds(left, INDICATOR.top, left + INDICATOR.width, INDICATOR.top + INDICATOR.height);
    this.ripple.setState(this.getDrawableState());
  }

  override invalidateDrawable(who: import('../graphics/drawable').Drawable): void {
    if (who === this.ripple) this.invalidate();
    else super.invalidateDrawable(who);
  }

  protected override onDraw(canvas: Canvas): void {
    const theme = this.context.getTheme();
    const width = this.getWidth();
    const p = this.activeProgress;
    const w = canvas.writer;
    const cx = width / 2;
    if (p > 0) {
      // the indicator grows out from the center
      const iw = INDICATOR.width * (0.5 + 0.5 * p);
      const color = withAlphaArgb(theme.getColor('colorSecondaryContainer'), p);
      w.fillRRect(cx - iw / 2, INDICATOR.top, iw, INDICATOR.height, [16, 16, 16, 16], Color.toRgba(color));
    }
    const active = this.bar.getSelectedItemId() === this.item.getItemId();
    const icon = this.item.getIcon();
    const iconTop = INDICATOR.top + (INDICATOR.height - 24) / 2;
    if (icon) {
      icon.setTint(active ? theme.getColor('colorOnSecondaryContainer') : theme.getColor('colorOnSurfaceVariant'));
      icon.setBounds(cx - 12, iconTop, cx + 12, iconTop + 24);
      icon.draw(canvas);
    }
    if (this.bar.showsLabel(this.item)) {
      const spec = TextAppearance.LabelMedium;
      const font = new Typeface('sans-serif', active ? 700 : spec.weight, false).css(spec.size);
      const tracking = spec.letterSpacing * spec.size;
      const label = this.item.getTitle();
      const textWidth = this.context.kernel.measurer.width(label, font, tracking);
      w.font(font);
      const color = active ? theme.getColor('colorOnSurface') : theme.getColor('colorOnSurfaceVariant');
      w.text(cx - textWidth / 2, INDICATOR.top + INDICATOR.height + 4 + 13, Color.toRgba(color), tracking, label);
    }
    this.badge?.draw(canvas, cx + 6, iconTop - 2);
    this.ripple.drawRipple(w);
  }

  override performClick(): boolean {
    this.bar.select(this.item, true);
    return super.performClick();
  }
}

export type OnItemSelectedListener = (item: MenuItem) => boolean;
export type OnItemReselectedListener = (item: MenuItem) => void;

export class NavigationBarView extends ViewGroup {
  static readonly LABEL_VISIBILITY_AUTO = LabelVisibility.AUTO;
  static readonly LABEL_VISIBILITY_SELECTED = LabelVisibility.SELECTED;
  static readonly LABEL_VISIBILITY_LABELED = LabelVisibility.LABELED;
  static readonly LABEL_VISIBILITY_UNLABELED = LabelVisibility.UNLABELED;
  static readonly MAX_ITEM_COUNT = 5;

  private readonly menu: Menu;
  private items: NavigationBarItemView[] = [];
  private selectedId = View.NO_ID;
  private labelVisibility: number = LabelVisibility.LABELED;
  private selectedListener: OnItemSelectedListener | null = null;
  private reselectedListener: OnItemReselectedListener | null = null;
  private readonly badges = new Map<number, BadgeDrawable>();
  private bottomInset = 0;

  constructor(context: Context) {
    super(context);
    this.setBackgroundColor(context.getTheme().getColor('colorSurfaceContainer'));
    this.menu = new Menu(context);
    this.menu.onChanged(() => this.rebuild());
  }

  getMenu(): Menu {
    return this.menu;
  }

  /** inflateMenu with the menu resource given as data. */
  inflateMenu(specs: readonly MenuSpec[]): void {
    this.menu.inflate(specs);
  }

  getMaxItemCount(): number {
    return NavigationBarView.MAX_ITEM_COUNT;
  }

  setOnItemSelectedListener(listener: OnItemSelectedListener | null): void {
    this.selectedListener = listener;
  }

  setOnItemReselectedListener(listener: OnItemReselectedListener | null): void {
    this.reselectedListener = listener;
  }

  getSelectedItemId(): number {
    return this.selectedId;
  }

  /** Select an item as if tapped: the listener may refuse it. */
  setSelectedItemId(itemId: number): void {
    const item = this.menu.findItem(itemId);
    if (item) this.select(item, true);
  }

  setLabelVisibilityMode(mode: number): void {
    this.labelVisibility = mode;
    this.invalidateItems();
  }

  getLabelVisibilityMode(): number {
    return this.labelVisibility;
  }

  /** @internal does this item show its label now? */
  showsLabel(item: MenuItem): boolean {
    const mode = this.labelVisibility === LabelVisibility.AUTO ? (this.items.length > 3 ? LabelVisibility.SELECTED : LabelVisibility.LABELED) : this.labelVisibility;
    if (mode === LabelVisibility.LABELED) return true;
    if (mode === LabelVisibility.UNLABELED) return false;
    return item.getItemId() === this.selectedId;
  }

  getOrCreateBadge(itemId: number): BadgeDrawable {
    let badge = this.badges.get(itemId);
    if (!badge) {
      badge = new BadgeDrawable(this);
      this.badges.set(itemId, badge);
      this.invalidateItems();
    }
    return badge;
  }

  getBadge(itemId: number): BadgeDrawable | null {
    return this.badges.get(itemId) ?? null;
  }

  removeBadge(itemId: number): void {
    this.badges.delete(itemId);
    this.invalidateItems();
  }

  private invalidateItems(): void {
    for (const v of this.items) {
      v.badge = this.badges.get(v.item.getItemId()) ?? null;
      v.invalidate();
    }
  }

  /** @internal a tap (or setSelectedItemId) on an item */
  select(item: MenuItem, fromUser: boolean): void {
    if (item.getItemId() === this.selectedId) {
      if (fromUser) this.reselectedListener?.(item);
      return;
    }
    if (fromUser && this.selectedListener && !this.selectedListener(item)) return;
    const previous = this.items.find((v) => v.item.getItemId() === this.selectedId);
    this.selectedId = item.getItemId();
    item.setChecked(true);
    const next = this.items.find((v) => v.item === item);
    this.animateIndicator(previous ?? null, next ?? null);
    this.requestLayout();
  }

  private animateIndicator(from: NavigationBarItemView | null, to: NavigationBarItemView | null): void {
    const anim = ValueAnimator.ofFloat(0, 1);
    anim.setKernel(this.context.kernel);
    anim.setDuration(MaterialMotion.duration.medium1);
    anim.setInterpolator(MaterialMotion.easing.emphasized);
    anim.addUpdateListener((a) => {
      const t = a.getAnimatedValue() as number;
      if (from) {
        from.activeProgress = 1 - t;
        from.invalidate();
      }
      if (to) {
        to.activeProgress = t;
        to.invalidate();
      }
    });
    anim.start();
  }

  private rebuild(): void {
    const items = this.menu.items().filter((i) => i.isVisible());
    if (items.length > NavigationBarView.MAX_ITEM_COUNT) {
      throw new Error(`IllegalArgumentException: Maximum number of items supported by BottomNavigationView is ${NavigationBarView.MAX_ITEM_COUNT}. Limit can be checked with BottomNavigationView#getMaxItemCount()`);
    }
    // keep the views of items that stay (a check-state change rebuilds nothing)
    const old = new Map(this.items.map((v) => [v.item, v] as const));
    const next = items.map((item) => old.get(item) ?? new NavigationBarItemView(this.context, item, this));
    const same = next.length === this.items.length && next.every((v, i) => v === this.items[i]);
    if (!same) {
      for (const v of this.items) this.removeView(v);
      this.items = next;
      for (const v of this.items) this.addView(v);
    }
    if (!items.some((i) => i.getItemId() === this.selectedId)) this.selectedId = items[0]?.getItemId() ?? View.NO_ID;
    if (!same) for (const v of this.items) v.activeProgress = v.item.getItemId() === this.selectedId ? 1 : 0;
    this.invalidateItems();
    if (!same) this.requestLayout();
  }

  /** The navigation bar inset pads the bar (paddingBottomSystemWindowInsets). */
  override onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    this.bottomInset = insets.getInsets(WindowInsetsType.navigationBars()).bottom;
    this.requestLayout();
    return insets;
  }

  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const width = View.getDefaultSize(this.getSuggestedMinimumWidth(), widthMeasureSpec);
    const height = BAR_HEIGHT + this.bottomInset;
    const count = this.items.length || 1;
    for (const v of this.items) v.measure(MeasureSpec.makeMeasureSpec(width / count, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(BAR_HEIGHT, MeasureSpec.EXACTLY));
    this.setMeasuredDimension(width, View.resolveSize(height, heightMeasureSpec));
  }

  protected override onLayout(_changed: boolean, l: number, _t: number, r: number): void {
    const count = this.items.length || 1;
    const w = (r - l) / count;
    this.items.forEach((v, i) => v.layout(i * w, 0, (i + 1) * w, BAR_HEIGHT));
  }

  /** @internal the item views (tests) */
  get itemViews(): readonly View[] {
    return this.items;
  }
}

export class BottomNavigationView extends NavigationBarView {}
