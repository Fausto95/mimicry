import { NotificationCenter } from '../foundation/notification-center';
import type { UIImage } from './ui-image';

/**
 * UIPasteboard: the general pasteboard and named ones, in memory (the host
 * clipboard is not read: that would prompt, like iOS's paste banner, on
 * every launch). Items are type → value maps; strings, URLs and images
 * have their conveniences. Changes bump changeCount and post
 * UIPasteboardChangedNotification.
 */
export const UIPasteboardChangedNotification = 'UIPasteboardChangedNotification';

type Item = Record<string, unknown>;

const STRING = 'public.utf8-plain-text';
const URL = 'public.url';
const IMAGE = 'public.png';

export class UIPasteboard {
  private static readonly generalBoard = new UIPasteboard('com.apple.UIKit.pboard.general');
  private static readonly named = new Map<string, UIPasteboard>();
  private _items: Item[] = [];
  private _changeCount = 0;

  private constructor(readonly name: string) {}

  static get general(): UIPasteboard {
    return UIPasteboard.generalBoard;
  }

  /** UIPasteboard(name:create:) */
  static withName(name: string, create = true): UIPasteboard | null {
    let board = UIPasteboard.named.get(name);
    if (!board && create) UIPasteboard.named.set(name, (board = new UIPasteboard(name)));
    return board ?? null;
  }

  static withUniqueName(): UIPasteboard {
    return UIPasteboard.withName(`com.apple.UIKit.pboard.${Math.random().toString(36).slice(2)}`)!;
  }

  get changeCount(): number {
    return this._changeCount;
  }

  get items(): readonly Item[] {
    return this._items;
  }

  set items(items: readonly Item[]) {
    this.setItems([...items]);
  }

  setItems(items: Item[]): void {
    this._items = items.map((i) => ({ ...i }));
    this._changeCount++;
    NotificationCenter.default.post(UIPasteboardChangedNotification, this);
  }

  get numberOfItems(): number {
    return this._items.length;
  }

  private values<T>(type: string): T[] {
    return this._items.map((i) => i[type]).filter((v): v is T => v !== undefined);
  }

  get string(): string | null {
    return this.values<string>(STRING)[0] ?? null;
  }

  set string(value: string | null) {
    this.setItems(value === null ? [] : [{ [STRING]: value }]);
  }

  get strings(): string[] | null {
    const v = this.values<string>(STRING);
    return v.length ? v : null;
  }

  set strings(values: string[] | null) {
    this.setItems((values ?? []).map((v) => ({ [STRING]: v })));
  }

  get hasStrings(): boolean {
    return this.values(STRING).length > 0;
  }

  get url(): string | null {
    return this.values<string>(URL)[0] ?? null;
  }

  set url(value: string | null) {
    this.setItems(value === null ? [] : [{ [URL]: value, [STRING]: value }]);
  }

  get hasURLs(): boolean {
    return this.values(URL).length > 0;
  }

  get image(): UIImage | null {
    return this.values<UIImage>(IMAGE)[0] ?? null;
  }

  set image(value: UIImage | null) {
    this.setItems(value === null ? [] : [{ [IMAGE]: value }]);
  }

  get hasImages(): boolean {
    return this.values(IMAGE).length > 0;
  }

  /** setValue(_:forPasteboardType:) */
  setValue(value: unknown, forPasteboardType: string): void {
    this.setItems([{ [forPasteboardType]: value }]);
  }

  value(forPasteboardType: string): unknown {
    return this.values(forPasteboardType)[0] ?? null;
  }
}
