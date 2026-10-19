import type { UIBarButtonItem } from './ui-bar-button-item';
import type { UINavigationBarAppearance } from './ui-navigation-bar-appearance';
import type { UIView } from './ui-view';

/**
 * UINavigationItem: what a view controller shows in the navigation bar
 * while it is on top — title or titleView, bar button items, back button
 * settings, large title mode and per-item appearances. The bar listens for
 * changes (`_onChange`).
 */
export enum UINavigationItemLargeTitleDisplayMode { automatic = 0, always = 1, never = 2, inline = 3 }
export enum UINavigationItemBackButtonDisplayMode { default = 0, generic = 1, minimal = 2 }

export class UINavigationItem {
  private _title: string | null;
  private _titleView: UIView | null = null;
  private _leftBarButtonItems: UIBarButtonItem[] = [];
  private _rightBarButtonItems: UIBarButtonItem[] = [];
  private _hidesBackButton = false;
  private _largeTitleDisplayMode = UINavigationItemLargeTitleDisplayMode.automatic;
  private _prompt: string | null = null;
  /** the back button the *next* item shows (its title, or the default chevron when null) */
  backBarButtonItem: UIBarButtonItem | null = null;
  /** iOS 11: the title the next item's back button uses */
  backButtonTitle: string | null = null;
  backButtonDisplayMode = UINavigationItemBackButtonDisplayMode.default;
  leftItemsSupplementBackButton = false;
  standardAppearance: UINavigationBarAppearance | null = null;
  scrollEdgeAppearance: UINavigationBarAppearance | null = null;
  compactAppearance: UINavigationBarAppearance | null = null;
  /** iOS 14: the menu of the back button's long press */
  backButtonMenuEnabled = true;
  private readonly listeners = new Set<() => void>();

  constructor(title: string | null = null) {
    this._title = title;
  }

  private changed(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** @internal the bar showing this item redraws when it changes */
  _onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get title(): string | null { return this._title; }
  set title(v: string | null) { this._title = v; this.changed(); }

  get titleView(): UIView | null { return this._titleView; }
  set titleView(v: UIView | null) { this._titleView = v; this.changed(); }

  get prompt(): string | null { return this._prompt; }
  set prompt(v: string | null) { this._prompt = v; this.changed(); }

  get hidesBackButton(): boolean { return this._hidesBackButton; }
  set hidesBackButton(v: boolean) { this._hidesBackButton = v; this.changed(); }

  setHidesBackButton(hides: boolean, _animated: boolean): void {
    this.hidesBackButton = hides;
  }

  get largeTitleDisplayMode(): UINavigationItemLargeTitleDisplayMode { return this._largeTitleDisplayMode; }
  set largeTitleDisplayMode(v: UINavigationItemLargeTitleDisplayMode) { this._largeTitleDisplayMode = v; this.changed(); }

  get leftBarButtonItem(): UIBarButtonItem | null { return this._leftBarButtonItems[0] ?? null; }
  set leftBarButtonItem(item: UIBarButtonItem | null) { this.leftBarButtonItems = item ? [item] : []; }

  get rightBarButtonItem(): UIBarButtonItem | null { return this._rightBarButtonItems[0] ?? null; }
  set rightBarButtonItem(item: UIBarButtonItem | null) { this.rightBarButtonItems = item ? [item] : []; }

  /** leading to trailing */
  get leftBarButtonItems(): readonly UIBarButtonItem[] { return this._leftBarButtonItems; }
  set leftBarButtonItems(items: readonly UIBarButtonItem[] | null) {
    this._leftBarButtonItems = items ? [...items] : [];
    this.changed();
  }

  /** trailing to leading, like UIKit */
  get rightBarButtonItems(): readonly UIBarButtonItem[] { return this._rightBarButtonItems; }
  set rightBarButtonItems(items: readonly UIBarButtonItem[] | null) {
    this._rightBarButtonItems = items ? [...items] : [];
    this.changed();
  }

  setLeftBarButtonItems(items: UIBarButtonItem[] | null, _animated: boolean): void {
    this.leftBarButtonItems = items;
  }

  setRightBarButtonItems(items: UIBarButtonItem[] | null, _animated: boolean): void {
    this.rightBarButtonItems = items;
  }
}
