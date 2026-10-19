import { uikitEase, type LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { ControlTween } from './control-tween';
import { UIColor } from './ui-color';
import { UIView } from './ui-view';

/**
 * UIProgressView: a 4 pt capsule track (default style; `bar` is square and
 * 2.5 pt) filled to `progress`, animated over 0.25 s on request.
 */
export enum UIProgressViewStyle { default = 0, bar = 1 }

export class UIProgressView extends UIView {
  private _progress = 0;
  progressViewStyle: UIProgressViewStyle;
  progressTintColor: UIColor | null = null;
  trackTintColor: UIColor | null = null;
  private readonly shown: ControlTween;

  constructor(style: UIProgressViewStyle = UIProgressViewStyle.default, frame?: CGRect) {
    super(frame);
    this.progressViewStyle = style;
    this.shown = new ControlTween(0, () => this.setNeedsDisplay());
  }

  get progress(): number {
    return this._progress;
  }

  set progress(p: number) {
    this.setProgress(p, false);
  }

  setProgress(p: number, animated: boolean): void {
    this._progress = Math.max(0, Math.min(1, p));
    if (animated) this.shown.animate(this._progress, 0.25, { curve: uikitEase });
    else this.shown.set(this._progress);
  }

  private get thickness(): number {
    return this.progressViewStyle === UIProgressViewStyle.bar ? 2.5 : 4;
  }

  override sizeThatFits(size: CGSize): CGSize {
    return { width: Number.isFinite(size.width) && size.width > 0 ? size.width : 150, height: this.thickness };
  }

  override get intrinsicContentSize(): CGSize {
    return { width: -1, height: this.thickness };
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const h = this.thickness;
    const width = this.bounds.size.width;
    const y = ctx.y + (this.bounds.size.height - h) / 2;
    const r = this.progressViewStyle === UIProgressViewStyle.bar ? 0 : h / 2;
    const track = this.trackTintColor?.resolvedColor(traits).rgba ?? UIColor.systemFill.resolvedColor(traits).rgba;
    const fill = (this.progressTintColor ?? this.tintColor ?? UIColor.tintColor).resolvedColor(traits).rgba;
    const filled = width * this.shown.value;
    ctx.item({ x: ctx.x, y, w: width, h }, (w) => {
      w.fillRRect(ctx.x, y, width, h, [r, r, r, r], track);
      if (filled > 0) w.fillRRect(ctx.x, y, filled, h, [r, r, r, r], fill);
    });
  }
}
