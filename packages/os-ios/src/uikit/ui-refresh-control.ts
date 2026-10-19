import { withAlpha } from '@mimicry/protocol';
import { inflate, uikitEase, type LayerContext } from '@mimicry/os-core';
import { iosKit } from '../theme';
import type { NSAttributedString } from '../foundation/ns-attributed-string';
import { CAEnvironment, mediaNow } from '../quartz-core/ca-media-time';
import { ControlTween } from './control-tween';
import { drawCenteredText } from './text-system';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import { UIFont } from './ui-font';
import type { UIScrollView } from './ui-scroll-view';

/**
 * UIRefreshControl: pull-to-refresh for a scroll view
 * (`scrollView.refreshControl = …`). It sits just above the content. As
 * the content is pulled down its spinner's spokes appear one by one; past
 * the trigger distance, while still dragging, it starts refreshing and
 * sends valueChanged. On release the scroll view settles with the spinner
 * showing (its top inset grows by the control's height) until
 * `endRefreshing()` animates the inset away.
 */
const HEIGHT = 60;
/** how far the content must be pulled to refresh */
const TRIGGER = 100;
const SPINNER = 26;

export class UIRefreshControl extends UIControl {
  private _isRefreshing = false;
  attributedTitle: NSAttributedString | null = null;
  /** @internal extra top inset of the scroll view while refreshing */
  readonly _inset: ControlTween;
  private scrollView: UIScrollView | null = null;
  private pull = 0;
  private spinStart = 0;
  private armed = true;

  constructor() {
    super();
    this._inset = new ControlTween(0, () => this.scrollView?._refreshInsetChanged());
  }

  get isRefreshing(): boolean {
    return this._isRefreshing;
  }

  /** beginRefreshing(): shows the spinner (does not send valueChanged). */
  beginRefreshing(): void {
    if (this._isRefreshing) return;
    this._isRefreshing = true;
    this.spinStart = mediaNow(CAEnvironment.kernel);
    this.tickSpinner();
    if (!this.scrollView?.isDragging) this._inset.animate(HEIGHT, 0.3, { curve: uikitEase });
  }

  /** endRefreshing(): the spinner goes and the content slides back up. */
  endRefreshing(): void {
    if (!this._isRefreshing) return;
    this._isRefreshing = false;
    this._inset.animate(0, 0.35, { curve: uikitEase });
    this.setNeedsDisplay();
  }

  /** @internal attached to / detached from a scroll view */
  _attach(scrollView: UIScrollView | null): void {
    this.scrollView = scrollView;
    this._scrolled();
  }

  /** @internal the scroll view moved: follow the pull. */
  _scrolled(): void {
    const sv = this.scrollView;
    if (!sv) return;
    const top = sv.adjustedContentInset.top - this._inset.value;
    this.pull = Math.max(0, -sv.contentOffset.y - top);
    this.frame = { origin: { x: 0, y: -HEIGHT }, size: { width: sv.bounds.size.width, height: HEIGHT } };
    if (sv.isDragging && this.armed && !this._isRefreshing && this.pull >= TRIGGER) {
      this.armed = false;
      this.beginRefreshing();
      this.sendActions(UIControlEvents.valueChanged, null);
    }
    if (this.pull === 0 && !sv.isDragging) this.armed = true;
    this.setNeedsDisplay();
  }

  /** @internal the finger lifted: settle with the spinner showing. */
  _endedDragging(): void {
    if (this._isRefreshing && this._inset.target < HEIGHT) this._inset.set(HEIGHT);
    if (!this._isRefreshing) this.armed = true;
  }

  private tickSpinner(): void {
    const kernel = CAEnvironment.kernel;
    if (!kernel) return;
    const task = {
      tick: () => {
        this.setNeedsDisplay();
        return this._isRefreshing && !!this.window;
      },
    };
    kernel.animator.add(task);
    kernel.requestFrame();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const tint = this.tintColor?.resolvedColor(traits).rgba ?? null;
    const b = this.bounds.size;
    const hasTitle = !!this.attributedTitle?.length;
    const cx = ctx.x + b.width / 2;
    const cy = ctx.y + (hasTitle ? b.height / 2 - 8 : b.height / 2);
    const x = cx - SPINNER / 2;
    const y = cy - SPINNER / 2;
    const appearance = traits.appearance;
    if (this._isRefreshing) {
      const time = (mediaNow(CAEnvironment.kernel) - this.spinStart) / 1000;
      ctx.item(inflate({ x, y, w: SPINNER, h: SPINNER }, 2), (w) => iosKit.drawActivity(w, x, y, SPINNER, { time, color: tint, animating: true }, appearance));
    } else if (this.pull > 0) {
      // Spokes appear clockwise from the top as the pull nears the trigger.
      const shown = Math.min(8, Math.floor((this.pull / TRIGGER) * 8));
      const color = tint ?? (appearance === 'dark' ? 0xebebf599 : 0x999999ff);
      ctx.item(inflate({ x, y, w: SPINNER, h: SPINNER }, 2), (w) => {
        for (let i = 0; i < shown; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const inner = SPINNER * 0.22;
          const outer = SPINNER * 0.46;
          w.pathBegin().moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner).lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          w.strokePath(withAlpha(color, 1), Math.max(1.5, SPINNER * 0.11), 1, 1);
        }
      });
    }
    if (hasTitle && (this.pull > 0 || this._isRefreshing)) {
      drawCenteredText(ctx, this.attributedTitle!.string, UIFont.systemFont(13), UIColor.secondaryLabel, cx, cy + SPINNER / 2 + 12, b.width - 32, traits);
    }
  }
}
