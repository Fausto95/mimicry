import type { Rect } from '../geometry/matrix';

/** An Image `source` (object, string, or the first of an array) → its URI. */
export function resolveSource(source: unknown): { uri: string; width?: number; height?: number } | null {
  if (!source) return null;
  if (Array.isArray(source)) return resolveSource(source[0]);
  if (typeof source === 'string') return { uri: source };
  if (typeof source === 'object' && typeof (source as any).uri === 'string') return source as any;
  return null;
}

/** Source and destination rectangles for a resizeMode (cover, contain, stretch, center). */
export function fitImage(mode: string, iw: number, ih: number, box: Rect) {
  const full = { sx: 0, sy: 0, sw: iw, sh: ih };
  if (mode === 'stretch' || !iw || !ih) return { dx: box.x, dy: box.y, dw: box.w, dh: box.h, ...full };
  const scaleCover = Math.max(box.w / iw, box.h / ih);
  const scaleContain = Math.min(box.w / iw, box.h / ih);
  if (mode === 'cover') {
    const sw = box.w / scaleCover;
    const sh = box.h / scaleCover;
    return { dx: box.x, dy: box.y, dw: box.w, dh: box.h, sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
  }
  const s = mode === 'center' ? Math.min(1, scaleContain) : scaleContain;
  const dw = iw * s;
  const dh = ih * s;
  return { dx: box.x + (box.w - dw) / 2, dy: box.y + (box.h - dh) / 2, dw, dh, ...full };
}
