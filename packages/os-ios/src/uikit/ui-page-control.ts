import type { LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';

/**
 * UIPageControl: 8 pt dots, 16 pt apart (iOS 14+ metrics), the current one
 * opaque; a tap left or right of the current dot moves one page and sends
 * valueChanged. `backgroundStyle` prominent draws the capsule platter.
 */
export enum UIPageControlBackgroundStyle { automatic = 0, prominent = 1, minimal = 2 }

const DOT = 8;
const PITCH = 16;
const HEIGHT = 26;

export class UIPageControl extends UIControl {
  private _numberOfPages = 0;
  private _currentPage = 0;
  hidesForSinglePage = false;
  pageIndicatorTintColor: UIColor | null = null;
  currentPageIndicatorTintColor: UIColor | null = null;
  backgroundStyle = UIPageControlBackgroundStyle.automatic;

  get numberOfPages(): number {
    return this._numberOfPages;
  }

  set numberOfPages(n: number) {
    this._numberOfPages = Math.max(0, n);
    this._currentPage = Math.min(this._currentPage, Math.max(0, n - 1));
    this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  get currentPage(): number {
    return this._currentPage;
  }

  set currentPage(page: number) {
    this._currentPage = Math.max(0, Math.min(page, this._numberOfPages - 1));
    this.setNeedsDisplay();
  }

  /** size(forNumberOfPages:) */
  sizeForNumberOfPages(pages: number): CGSize {
    return { width: pages > 0 ? (pages - 1) * PITCH + DOT + 24 : 0, height: HEIGHT };
  }

  override sizeThatFits(): CGSize {
    return this.sizeForNumberOfPages(this._numberOfPages);
  }

  override get intrinsicContentSize(): CGSize {
    return this.sizeForNumberOfPages(this._numberOfPages);
  }

  override endTracking(touch: UITouch | null, event: UIEvent | null): void {
    if (!touch || this._numberOfPages < 2) return;
    const p = touch.location(this);
    const dots = this.dotsOrigin();
    const current = dots + this._currentPage * PITCH + DOT / 2;
    const next = p.x < current ? this._currentPage - 1 : this._currentPage + 1;
    if (next < 0 || next >= this._numberOfPages) return;
    this.currentPage = next;
    this.sendActions(UIControlEvents.valueChanged, event);
  }

  private dotsOrigin(): number {
    const w = (this._numberOfPages - 1) * PITCH + DOT;
    return (this.bounds.size.width - w) / 2;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const n = this._numberOfPages;
    if (n === 0 || (n === 1 && this.hidesForSinglePage)) return;
    const traits = this.traitCollection;
    const current = (this.currentPageIndicatorTintColor ?? UIColor.label).resolvedColor(traits).rgba;
    const other = (this.pageIndicatorTintColor ?? UIColor.tertiaryLabel).resolvedColor(traits).rgba;
    const x0 = ctx.x + this.dotsOrigin();
    const cy = ctx.y + this.bounds.size.height / 2;
    const w = (n - 1) * PITCH + DOT;
    ctx.item({ x: x0 - 14, y: cy - HEIGHT / 2, w: w + 28, h: HEIGHT }, (wr) => {
      if (this.backgroundStyle === UIPageControlBackgroundStyle.prominent) {
        const r = HEIGHT / 2;
        wr.fillRRect(x0 - 12, cy - r, w + 24, HEIGHT, [r, r, r, r], 0x7676803d);
      }
      for (let i = 0; i < n; i++) {
        const cx = x0 + i * PITCH + DOT / 2;
        wr.pathBegin().arc(cx, cy, DOT / 2, 0, Math.PI * 2).closePath().fillPath(i === this._currentPage ? current : other);
      }
    });
  }
}
