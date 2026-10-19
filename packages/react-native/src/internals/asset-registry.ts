/**
 * React Native's asset registry: `require('./logo.png')` evaluates to a
 * number, and `Image.resolveAssetSource` turns it back into a source. The
 * compiler emits `registerAsset({...})` for every image module.
 */
export interface PackagerAsset {
  __packager_asset?: boolean;
  uri: string;
  width: number;
  height: number;
  scale: number;
  name?: string;
  type?: string;
  httpServerLocation?: string;
  scales?: number[];
  hash?: string;
  fileHashes?: string[];
}

const assets: PackagerAsset[] = [];
const byUri = new Map<string, number>();

export function registerAsset(asset: PackagerAsset): number {
  const known = byUri.get(asset.uri);
  if (known !== undefined) return known;
  const scales = asset.scales ?? [asset.scale];
  const name = asset.name ?? (asset.uri.startsWith('data:') ? 'asset' : asset.uri.split('/').pop()!.replace(/@\dx(?=\.)/, '').replace(/\.[^.]+$/, ''));
  const type = asset.type ?? (/\.([a-z0-9]+)(?:\?|$)/i.exec(asset.uri)?.[1] ?? 'png');
  assets.push({ __packager_asset: true, httpServerLocation: '/assets', hash: String(assets.length + 1), fileHashes: [], ...asset, scales, name, type });
  byUri.set(asset.uri, assets.length);
  return assets.length;
}

export function getAssetByID(id: number): PackagerAsset | undefined {
  return assets[id - 1];
}

/** `Image.resolveAssetSource`: numbers become `{ uri, width, height, scale }`. */
export function resolveAssetSource(source: unknown): any {
  if (typeof source === 'number') {
    const asset = getAssetByID(source);
    return asset ? { __packager_asset: true, uri: asset.uri, width: asset.width, height: asset.height, scale: asset.scale } : null;
  }
  if (typeof source === 'string') return { uri: source };
  return source ?? null;
}

/** Image `source` props in any accepted form → what the engine reads. */
export function normalizeImageSource(source: unknown): any {
  if (Array.isArray(source)) return source.map(resolveAssetSource);
  return resolveAssetSource(source);
}
