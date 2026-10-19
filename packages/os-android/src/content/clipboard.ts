import type { CharSequence } from '../text/spanned';

/**
 * android.content.ClipboardManager and ClipData, in memory (one clipboard
 * per device; the host's clipboard is not touched). Listeners hear every
 * change of the primary clip.
 */
export class ClipDataItem {
  constructor(private readonly text: CharSequence | null, private readonly uri: string | null = null, private readonly html: string | null = null) {}
  getText(): CharSequence | null {
    return this.text;
  }
  getUri(): string | null {
    return this.uri;
  }
  getHtmlText(): string | null {
    return this.html;
  }
  coerceToText(): CharSequence {
    return this.text ?? this.uri ?? '';
  }
}

export class ClipDescription {
  static readonly MIMETYPE_TEXT_PLAIN = 'text/plain';
  static readonly MIMETYPE_TEXT_HTML = 'text/html';
  static readonly MIMETYPE_TEXT_URILIST = 'text/uri-list';
  constructor(private readonly label: CharSequence, private readonly mimeTypes: string[]) {}
  getLabel(): CharSequence {
    return this.label;
  }
  hasMimeType(mime: string): boolean {
    return this.mimeTypes.some((m) => m === mime || (mime.endsWith('/*') && m.startsWith(mime.slice(0, -1))));
  }
  getMimeTypeCount(): number {
    return this.mimeTypes.length;
  }
  getMimeType(index: number): string {
    return this.mimeTypes[index] ?? '';
  }
}

export class ClipData {
  static readonly Item = ClipDataItem;
  private readonly items: ClipDataItem[];

  constructor(private readonly description: ClipDescription, item: ClipDataItem) {
    this.items = [item];
  }

  static newPlainText(label: CharSequence, text: CharSequence): ClipData {
    return new ClipData(new ClipDescription(label, [ClipDescription.MIMETYPE_TEXT_PLAIN]), new ClipDataItem(text));
  }

  static newHtmlText(label: CharSequence, text: CharSequence, htmlText: string): ClipData {
    return new ClipData(new ClipDescription(label, [ClipDescription.MIMETYPE_TEXT_HTML]), new ClipDataItem(text, null, htmlText));
  }

  static newRawUri(label: CharSequence, uri: string): ClipData {
    return new ClipData(new ClipDescription(label, [ClipDescription.MIMETYPE_TEXT_URILIST]), new ClipDataItem(null, uri));
  }

  getDescription(): ClipDescription {
    return this.description;
  }

  getItemCount(): number {
    return this.items.length;
  }

  getItemAt(index: number): ClipDataItem {
    const item = this.items[index];
    if (!item) throw new Error(`IndexOutOfBoundsException: ${index}`);
    return item;
  }

  addItem(item: ClipDataItem): void {
    this.items.push(item);
  }
}

export class ClipboardManager {
  private clip: ClipData | null = null;
  private readonly listeners = new Set<() => void>();

  setPrimaryClip(clip: ClipData): void {
    this.clip = clip;
    for (const l of Array.from(this.listeners)) l();
  }

  getPrimaryClip(): ClipData | null {
    return this.clip;
  }

  getPrimaryClipDescription(): ClipDescription | null {
    return this.clip?.getDescription() ?? null;
  }

  hasPrimaryClip(): boolean {
    return this.clip !== null;
  }

  clearPrimaryClip(): void {
    this.clip = null;
    for (const l of Array.from(this.listeners)) l();
  }

  addPrimaryClipChangedListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  removePrimaryClipChangedListener(listener: () => void): void {
    this.listeners.delete(listener);
  }
}
