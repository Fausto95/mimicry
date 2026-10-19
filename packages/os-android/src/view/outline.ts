import type { Radii } from '@mimicry/protocol';
import type { View } from './view';

/**
 * android.graphics.Outline and android.view.ViewOutlineProvider: the shape
 * a view casts its elevation shadow from and clips to (setClipToOutline).
 * Outlines are rectangles, rounded rectangles (per-corner radii, which the
 * framework only reaches through a Path) or ovals.
 */
export class Outline {
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;
  radii: Radii = [0, 0, 0, 0];
  private empty = true;
  private alpha = 1;

  setEmpty(): void {
    this.empty = true;
    this.left = this.top = this.right = this.bottom = 0;
    this.radii = [0, 0, 0, 0];
  }

  isEmpty(): boolean {
    return this.empty || this.right <= this.left || this.bottom <= this.top;
  }

  setRect(left: number, top: number, right: number, bottom: number): void {
    this.setRoundRect(left, top, right, bottom, 0);
  }

  setRoundRect(left: number, top: number, right: number, bottom: number, radius: number): void {
    this.setRoundRectRadii(left, top, right, bottom, [radius, radius, radius, radius]);
  }

  /** Mimicry: per-corner radii (top-left, top-right, bottom-right, bottom-left). */
  setRoundRectRadii(left: number, top: number, right: number, bottom: number, radii: Radii): void {
    this.empty = false;
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    const max = Math.min(right - left, bottom - top) / 2;
    this.radii = radii.map((r) => Math.max(0, Math.min(r, max))) as unknown as Radii;
  }

  setOval(left: number, top: number, right: number, bottom: number): void {
    const r = Math.min(right - left, bottom - top) / 2;
    this.setRoundRectRadii(left, top, right, bottom, [r, r, r, r]);
  }

  /** The uniform corner radius (the top-left one when they differ). */
  getRadius(): number {
    return this.radii[0];
  }

  setAlpha(alpha: number): void {
    this.alpha = alpha;
  }

  getAlpha(): number {
    return this.alpha;
  }

  canClip(): boolean {
    return !this.isEmpty();
  }

  set(other: Outline): void {
    this.left = other.left;
    this.top = other.top;
    this.right = other.right;
    this.bottom = other.bottom;
    this.radii = other.radii;
    this.empty = other.empty;
    this.alpha = other.alpha;
  }
}

export abstract class ViewOutlineProvider {
  /** The background drawable's outline (the default). */
  static readonly BACKGROUND: ViewOutlineProvider = new (class extends ViewOutlineProvider {
    getOutline(view: View, outline: Outline): void {
      const background = view.getBackground();
      if (background) background.getOutline(outline);
      else {
        outline.setRect(0, 0, view.getWidth(), view.getHeight());
        outline.setAlpha(0);
      }
    }
  })();

  /** The view's bounds. */
  static readonly BOUNDS: ViewOutlineProvider = new (class extends ViewOutlineProvider {
    getOutline(view: View, outline: Outline): void {
      outline.setRect(0, 0, view.getWidth(), view.getHeight());
    }
  })();

  /** The view's bounds inside its padding. */
  static readonly PADDED_BOUNDS: ViewOutlineProvider = new (class extends ViewOutlineProvider {
    getOutline(view: View, outline: Outline): void {
      outline.setRect(view.getPaddingLeft(), view.getPaddingTop(), view.getWidth() - view.getPaddingRight(), view.getHeight() - view.getPaddingBottom());
    }
  })();

  abstract getOutline(view: View, outline: Outline): void;
}
