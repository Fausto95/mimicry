import type { Engine } from './engine';
import type { HostNode } from './tree/node';

/**
 * Image metadata. The host owns decoded bitmaps (it is the one that paints);
 * the engine only needs sizes for layout and to know when an image can be
 * referenced from a chunk. An Image command is emitted only after the host
 * confirmed the load, so a cached raster never contains a missing image.
 */
export interface ImageEntry {
  uri: string;
  state: 'loading' | 'loaded' | 'error';
  width: number;
  height: number;
  error?: string;
  nodes: Set<HostNode>;
}

export class ImageStore {
  private readonly entries = new Map<string, ImageEntry>();
  /** the URI each image node currently shows */
  private readonly current = new WeakMap<HostNode, string>();

  constructor(private readonly engine: Engine) {}

  get(uri: string, node?: HostNode): ImageEntry {
    if (node) {
      const previous = this.current.get(node);
      if (previous !== undefined && previous !== uri) this.entries.get(previous)?.nodes.delete(node);
      this.current.set(node, uri);
    }
    let entry = this.entries.get(uri);
    // A failed image is retried when something asks for it again.
    if (entry && entry.state === 'error' && node && !entry.nodes.has(node)) {
      this.entries.delete(uri);
      entry = undefined;
    }
    if (!entry) {
      entry = { uri, state: 'loading', width: 0, height: 0, nodes: new Set() };
      this.entries.set(uri, entry);
      this.engine.send({ type: 'loadImage', uri });
      if (node) this.engine.events.emit(node, 'onLoadStart', { target: node.id }, this.engine.animator.animationTime);
    }
    if (node && !entry.nodes.has(node)) {
      entry.nodes.add(node);
      if (entry.state === 'loaded') this.engine.defer(() => this.notifyLoaded(entry!, node));
    }
    return entry;
  }

  loaded(uri: string, width: number, height: number): void {
    const entry = this.get(uri);
    entry.state = 'loaded';
    entry.width = width;
    entry.height = height;
    for (const node of entry.nodes) this.notifyLoaded(entry, node);
    this.engine.markPaint();
  }

  failed(uri: string, error: string): void {
    const entry = this.get(uri);
    entry.state = 'error';
    entry.error = error;
    const time = this.engine.animator.animationTime;
    for (const node of entry.nodes) {
      if (!node.mounted) continue;
      this.engine.events.emit(node, 'onError', { error, target: node.id }, time);
      this.engine.events.emit(node, 'onLoadEnd', { target: node.id }, time);
    }
  }

  private notifyLoaded(entry: ImageEntry, node: HostNode): void {
    if (!node.mounted) return;
    node.yoga?.markDirty();
    this.engine.invalidateLayout();
    const time = this.engine.animator.animationTime;
    const source = { uri: entry.uri, width: entry.width, height: entry.height };
    this.engine.events.emit(node, 'onLoad', { source, target: node.id }, time);
    this.engine.events.emit(node, 'onLoadEnd', { target: node.id }, time);
  }

  forget(node: HostNode): void {
    for (const entry of this.entries.values()) entry.nodes.delete(node);
  }

  size(uri: string): { width: number; height: number } | null {
    const e = this.entries.get(uri);
    return e && e.state === 'loaded' ? { width: e.width, height: e.height } : null;
  }
}
