import type { UIColor } from './ui-color';
import { UIImage } from './ui-image';

/**
 * UITabBarItem: a tab's title, image (selected image), badge and enabled
 * state. System items carry UIKit's titles and symbols. The tab bar
 * listens for changes (`_onChange`).
 */
export enum UITabBarSystemItem {
  more = 0, favorites = 1, featured = 2, topRated = 3, recents = 4, contacts = 5, history = 6, bookmarks = 7, search = 8,
  downloads = 9, mostRecent = 10, mostViewed = 11,
}

const SYSTEM: Record<UITabBarSystemItem, [title: string, symbol: string]> = {
  [UITabBarSystemItem.more]: ['More', 'ellipsis'],
  [UITabBarSystemItem.favorites]: ['Favorites', 'star.fill'],
  [UITabBarSystemItem.featured]: ['Featured', 'star.fill'],
  [UITabBarSystemItem.topRated]: ['Top Rated', 'star.fill'],
  [UITabBarSystemItem.recents]: ['Recents', 'clock'],
  [UITabBarSystemItem.contacts]: ['Contacts', 'person.crop.circle'],
  [UITabBarSystemItem.history]: ['History', 'clock.arrow.circlepath'],
  [UITabBarSystemItem.bookmarks]: ['Bookmarks', 'book'],
  [UITabBarSystemItem.search]: ['Search', 'magnifyingglass'],
  [UITabBarSystemItem.downloads]: ['Downloads', 'arrow.down.circle'],
  [UITabBarSystemItem.mostRecent]: ['Most Recent', 'clock'],
  [UITabBarSystemItem.mostViewed]: ['Most Viewed', 'list.number'],
};

export class UITabBarItem {
  private _title: string | null;
  private _image: UIImage | null;
  private _selectedImage: UIImage | null;
  private _badgeValue: string | null = null;
  private _isEnabled = true;
  badgeColor: UIColor | null = null;
  tag = 0;
  accessibilityLabel: string | null = null;
  readonly systemItem: UITabBarSystemItem | null = null;
  private readonly listeners = new Set<() => void>();

  /** UITabBarItem(title:image:selectedImage:) / (title:image:tag:) */
  constructor(title: string | null = null, image: UIImage | null = null, selectedImage: UIImage | null = null, tag = 0) {
    this._title = title;
    this._image = image;
    this._selectedImage = selectedImage;
    this.tag = tag;
  }

  /** UITabBarItem(tabBarSystemItem:tag:) */
  static system(systemItem: UITabBarSystemItem, tag = 0): UITabBarItem {
    const [title, symbol] = SYSTEM[systemItem];
    const item = new UITabBarItem(title, UIImage.systemName(symbol), null, tag);
    (item as { systemItem: UITabBarSystemItem | null }).systemItem = systemItem;
    return item;
  }

  private changed(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** @internal */
  _onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get title(): string | null { return this._title; }
  set title(v: string | null) { this._title = v; this.changed(); }
  get image(): UIImage | null { return this._image; }
  set image(v: UIImage | null) { this._image = v; this.changed(); }
  get selectedImage(): UIImage | null { return this._selectedImage; }
  set selectedImage(v: UIImage | null) { this._selectedImage = v; this.changed(); }
  get badgeValue(): string | null { return this._badgeValue; }
  set badgeValue(v: string | null) { this._badgeValue = v; this.changed(); }
  get isEnabled(): boolean { return this._isEnabled; }
  set isEnabled(v: boolean) { this._isEnabled = v; this.changed(); }
}
