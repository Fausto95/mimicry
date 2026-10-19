/**
 * The image decoder service. The host owns decoded bitmaps (it is the one
 * that paints); the OS only needs sizes for layout and to know when an image
 * can be referenced from a chunk. An Image command is emitted only after the
 * host confirmed the load, so a cached raster never contains a missing image.
 */
export interface ImageEntry {
  uri: string;
  state: 'loading' | 'loaded' | 'error';
  width: number;
  height: number;
  error?: string;
  consumers: Set<ImageConsumer>;
}

/** Something showing an image (UIImageView, ImageView, a framework's image component). */
export interface ImageConsumer {
  /** false once the consumer left the screen for good; it is no longer notified */
  readonly alive?: boolean;
  imageLoadStarted?(entry: ImageEntry): void;
  imageLoaded?(entry: ImageEntry): void;
  imageFailed?(entry: ImageEntry): void;
}

export interface ImageHost {
  requestImage(uri: string): void;
  /** run after the current task (cache hits are reported asynchronously, like on device) */
  defer(fn: () => void): void;
  imagesChanged(): void;
}

export class ImageStore {
  private readonly entries = new Map<string, ImageEntry>();
  /** the URI each consumer currently shows */
  private readonly current = new WeakMap<ImageConsumer, string>();

  constructor(private readonly host: ImageHost) {}

  get(uri: string, consumer?: ImageConsumer): ImageEntry {
    if (consumer) {
      const previous = this.current.get(consumer);
      if (previous !== undefined && previous !== uri) this.entries.get(previous)?.consumers.delete(consumer);
      this.current.set(consumer, uri);
    }
    let entry = this.entries.get(uri);
    // A failed image is retried when something asks for it again.
    if (entry && entry.state === 'error' && consumer && !entry.consumers.has(consumer)) {
      this.entries.delete(uri);
      entry = undefined;
    }
    if (!entry) {
      entry = { uri, state: 'loading', width: 0, height: 0, consumers: new Set() };
      this.entries.set(uri, entry);
      this.host.requestImage(uri);
      consumer?.imageLoadStarted?.(entry);
    }
    if (consumer && !entry.consumers.has(consumer)) {
      entry.consumers.add(consumer);
      const loaded = entry;
      if (loaded.state === 'loaded') this.host.defer(() => this.notify(loaded, consumer));
    }
    return entry;
  }

  loaded(uri: string, width: number, height: number): void {
    const entry = this.get(uri);
    entry.state = 'loaded';
    entry.width = width;
    entry.height = height;
    for (const consumer of entry.consumers) this.notify(entry, consumer);
    this.host.imagesChanged();
  }

  failed(uri: string, error: string): void {
    const entry = this.get(uri);
    entry.state = 'error';
    entry.error = error;
    for (const consumer of entry.consumers) {
      if (consumer.alive !== false) consumer.imageFailed?.(entry);
    }
  }

  private notify(entry: ImageEntry, consumer: ImageConsumer): void {
    if (consumer.alive !== false) consumer.imageLoaded?.(entry);
  }

  forget(consumer: ImageConsumer): void {
    for (const entry of this.entries.values()) entry.consumers.delete(consumer);
  }

  size(uri: string): { width: number; height: number } | null {
    const e = this.entries.get(uri);
    return e && e.state === 'loaded' ? { width: e.width, height: e.height } : null;
  }
}
