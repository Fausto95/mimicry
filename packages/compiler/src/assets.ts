import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** Where asset modules register themselves, as with Metro's asset plugin. */
export const ASSET_REGISTRY = '@react-native/assets-registry/registry';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
export const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);
export const ASSET_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS]);

export const isAsset = (file: string) => ASSET_EXTENSIONS.has(extname(file).toLowerCase());

/** Pixel size from the image header (PNG, JPEG, GIF, WebP, BMP). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  }
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      const length = view.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

/**
 * React Native picks `name@3x.png` / `@2x` variants for dense screens and
 * reports the 1x logical size. Prefer the densest variant available.
 */
export function resolveAssetVariant(file: string): { file: string; scale: number } {
  const ext = extname(file);
  const base = basename(file, ext).replace(/@\dx$/, '');
  const dir = dirname(file);
  for (const scale of [3, 2]) {
    const candidate = join(dir, `${base}@${scale}x${ext}`);
    if (existsSync(candidate)) return { file: candidate, scale };
  }
  const plain = join(dir, `${base}${ext}`);
  return { file: existsSync(plain) ? plain : file, scale: 1 };
}

export function assetModule(file: string, url: (absolutePath: string) => string): string {
  const ext = extname(file).toLowerCase();
  if (FONT_EXTENSIONS.has(ext)) {
    const asset = { __packager_asset: true, uri: url(file), width: 0, height: 0, scale: 1, type: ext.slice(1), name: basename(file, ext) };
    return `module.exports = require(${JSON.stringify(ASSET_REGISTRY)}).registerAsset(${JSON.stringify(asset)});`;
  }
  const variant = resolveAssetVariant(file);
  const size = imageSize(readFileSync(variant.file)) ?? { width: 0, height: 0 };
  const asset = {
    __packager_asset: true,
    uri: url(variant.file),
    width: size.width / variant.scale,
    height: size.height / variant.scale,
    scale: variant.scale,
  };
  return `module.exports = require(${JSON.stringify(ASSET_REGISTRY)}).registerAsset(${JSON.stringify(asset)});`;
}
