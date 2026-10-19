/**
 * 53-bit content hash over a word-aligned byte range (two 32-bit lanes,
 * cyrb53 mixing). Chunk rasters are cached by this value on the host, so it
 * must depend only on the bytes, never on where they sit in a frame.
 */
export function hashBytes(bytes: Uint8Array, start = 0, end = bytes.byteLength): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let h1 = 0xdeadbeef ^ (end - start);
  let h2 = 0x41c6ce57 ^ (end - start);
  let i = start;
  for (; i + 4 <= end; i += 4) {
    const w = view.getUint32(i, true);
    h1 = Math.imul(h1 ^ w, 2654435761);
    h2 = Math.imul(h2 ^ w, 1597334677);
  }
  for (; i < end; i++) {
    const b = bytes[i]!;
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Split a 53-bit hash into two u32 words for the wire. */
export const hashLo = (hash: number) => hash >>> 0;
export const hashHi = (hash: number) => Math.floor(hash / 4294967296) >>> 0;
export const joinHash = (lo: number, hi: number) => hi * 4294967296 + (lo >>> 0);

/** String hash for cache keys (FNV-1a). */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
