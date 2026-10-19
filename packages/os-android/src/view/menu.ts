import type { Context } from '../content/context';
import type { Drawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';

/**
 * android.view.Menu / MenuItem: the items of an options menu, a toolbar,
 * a popup menu or a navigation bar. Menus notify their owner when items
 * change so it can rebuild (invalidateOptionsMenu happens on its own).
 *
 * Menu resources are inflated from data (MenuSpec) since Mimicry has no
 * R.menu XML; icons are drawables or Material Symbols names.
 */
export type OnMenuItemClickListener = (item: MenuItem) => boolean;

export interface MenuSpec {
  id: number;
  title: string;
  icon?: string | Drawable;
  showAsAction?: number;
  groupId?: number;
  order?: number;
  checkable?: boolean;
  checked?: boolean;
  enabled?: boolean;
  visible?: boolean;
  contentDescription?: string;
}

export class MenuItem {
  static readonly SHOW_AS_ACTION_NEVER = 0;
  static readonly SHOW_AS_ACTION_IF_ROOM = 1;
  static readonly SHOW_AS_ACTION_ALWAYS = 2;
  static readonly SHOW_AS_ACTION_WITH_TEXT = 4;
  static readonly SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW = 8;

  private icon: Drawable | null = null;
  private showAsAction = MenuItem.SHOW_AS_ACTION_NEVER;
  private visible = true;
  private enabled = true;
  private checkable = false;
  private checked = false;
  private clickListener: OnMenuItemClickListener | null = null;
  private contentDescription: string | null = null;
  private tooltip: string | null = null;

  /** @internal */
  constructor(private readonly menu: Menu, private readonly groupId: number, private readonly itemId: number, private readonly order: number, private title: string) {}

  getItemId(): number { return this.itemId; }
  getGroupId(): number { return this.groupId; }
  getOrder(): number { return this.order; }
  getTitle(): string { return this.title; }

  setTitle(title: string): this {
    this.title = title;
    this.menu.changed();
    return this;
  }

  /** A drawable, or a Material Symbols icon name. */
  setIcon(icon: Drawable | string | null): this {
    this.icon = typeof icon === 'string' ? new MaterialIconDrawable(this.menu.context, icon) : icon;
    this.menu.changed();
    return this;
  }

  getIcon(): Drawable | null {
    return this.icon;
  }

  setShowAsAction(flags: number): void {
    this.showAsAction = flags;
    this.menu.changed();
  }

  setShowAsActionFlags(flags: number): this {
    this.setShowAsAction(flags);
    return this;
  }

  /** @internal */
  getShowAsAction(): number {
    return this.showAsAction;
  }

  setVisible(visible: boolean): this {
    this.visible = visible;
    this.menu.changed();
    return this;
  }

  isVisible(): boolean { return this.visible; }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.menu.changed();
    return this;
  }

  isEnabled(): boolean { return this.enabled; }

  setCheckable(checkable: boolean): this {
    this.checkable = checkable;
    this.menu.changed();
    return this;
  }

  isCheckable(): boolean { return this.checkable; }

  setChecked(checked: boolean): this {
    if (checked && this.menu.isExclusive(this.groupId)) {
      for (const other of this.menu.items()) if (other !== this && other.getGroupId() === this.groupId) other.checked = false;
    }
    this.checked = checked;
    this.menu.changed();
    return this;
  }

  isChecked(): boolean { return this.checked; }

  setOnMenuItemClickListener(listener: OnMenuItemClickListener | null): this {
    this.clickListener = listener;
    return this;
  }

  setContentDescription(description: string | null): this {
    this.contentDescription = description;
    return this;
  }

  getContentDescription(): string | null { return this.contentDescription; }

  setTooltipText(text: string | null): this {
    this.tooltip = text;
    return this;
  }

  getTooltipText(): string | null { return this.tooltip; }

  /** @internal the item's own listener first, then the menu owner's */
  invoke(ownerListener: OnMenuItemClickListener | null): boolean {
    if (!this.enabled) return false;
    if (this.clickListener?.(this)) return true;
    return ownerListener?.(this) ?? false;
  }

  hasSubMenu(): boolean {
    return false;
  }
}

export class Menu {
  static readonly NONE = 0;
  static readonly FIRST = 1;
  static readonly CATEGORY_CONTAINER = 0x10000;

  private readonly list: MenuItem[] = [];
  private readonly exclusiveGroups = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private batching = 0;

  constructor(readonly context: Context) {}

  /** add(title) or add(groupId, itemId, order, title) */
  add(groupIdOrTitle: number | string, itemId = Menu.NONE, order = Menu.NONE, title = ''): MenuItem {
    const item = typeof groupIdOrTitle === 'string'
      ? new MenuItem(this, Menu.NONE, Menu.NONE, Menu.NONE, groupIdOrTitle)
      : new MenuItem(this, groupIdOrTitle, itemId, order, title);
    // ordered by `order`, then insertion
    let at = this.list.length;
    while (at > 0 && this.list[at - 1]!.getOrder() > item.getOrder()) at--;
    this.list.splice(at, 0, item);
    this.changed();
    return item;
  }

  /** Mimicry: inflate a menu resource given as data. */
  inflate(specs: readonly MenuSpec[]): void {
    this.batching++;
    try {
      for (const s of specs) {
        const item = this.add(s.groupId ?? Menu.NONE, s.id, s.order ?? Menu.NONE, s.title);
        if (s.icon) item.setIcon(s.icon);
        if (s.showAsAction !== undefined) item.setShowAsAction(s.showAsAction);
        if (s.checkable) item.setCheckable(true);
        if (s.checked) item.setChecked(true);
        if (s.enabled === false) item.setEnabled(false);
        if (s.visible === false) item.setVisible(false);
        if (s.contentDescription) item.setContentDescription(s.contentDescription);
      }
    } finally {
      this.batching--;
    }
    this.changed();
  }

  findItem(id: number): MenuItem | null {
    return this.list.find((i) => i.getItemId() === id) ?? null;
  }

  getItem(index: number): MenuItem {
    const item = this.list[index];
    if (!item) throw new Error(`IndexOutOfBoundsException: ${index}`);
    return item;
  }

  size(): number {
    return this.list.length;
  }

  removeItem(id: number): void {
    const at = this.list.findIndex((i) => i.getItemId() === id);
    if (at >= 0) this.list.splice(at, 1);
    this.changed();
  }

  removeGroup(groupId: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.getGroupId() === groupId) this.list.splice(i, 1);
    this.changed();
  }

  clear(): void {
    this.list.length = 0;
    this.changed();
  }

  setGroupCheckable(groupId: number, checkable: boolean, exclusive: boolean): void {
    if (exclusive) this.exclusiveGroups.add(groupId);
    else this.exclusiveGroups.delete(groupId);
    for (const i of this.list) if (i.getGroupId() === groupId) i.setCheckable(checkable);
  }

  setGroupVisible(groupId: number, visible: boolean): void {
    for (const i of this.list) if (i.getGroupId() === groupId) i.setVisible(visible);
  }

  setGroupEnabled(groupId: number, enabled: boolean): void {
    for (const i of this.list) if (i.getGroupId() === groupId) i.setEnabled(enabled);
  }

  hasVisibleItems(): boolean {
    return this.list.some((i) => i.isVisible());
  }

  /** @internal */
  isExclusive(groupId: number): boolean {
    return this.exclusiveGroups.has(groupId);
  }

  /** @internal */
  items(): readonly MenuItem[] {
    return this.list;
  }

  /** @internal the owner rebuilds on changes */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @internal */
  changed(): void {
    if (this.batching) return;
    for (const l of Array.from(this.listeners)) l();
  }
}
