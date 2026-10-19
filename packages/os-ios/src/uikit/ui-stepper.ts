import type { LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { CAEnvironment } from '../quartz-core/ca-media-time';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import { UIUserInterfaceStyle } from './ui-trait-collection';

/**
 * UIStepper: a 94×32 capsule with − and + halves (iOS 26 look). A press
 * steps once; held, it repeats after 0.5 s, every 0.1 s (`autorepeat`).
 * valueChanged per step (or once on release when not `isContinuous`). At
 * the limits the half dims, or the value wraps (`wraps`).
 */
const SIZE = { width: 94, height: 32 };
const REPEAT_DELAY = 500;
const REPEAT_INTERVAL = 100;

export class UIStepper extends UIControl {
  private _value = 0;
  minimumValue = 0;
  maximumValue = 100;
  stepValue = 1;
  autorepeat = true;
  wraps = false;
  isContinuous = true;
  private side: -1 | 0 | 1 = 0;
  private timer: unknown = null;
  private stepped = false;

  constructor(frame?: CGRect) {
    super(frame ?? { origin: { x: 0, y: 0 }, size: SIZE });
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = Math.max(this.minimumValue, Math.min(this.maximumValue, v));
    this.setNeedsDisplay();
  }

  override sizeThatFits(): CGSize {
    return SIZE;
  }

  override get intrinsicContentSize(): CGSize {
    return SIZE;
  }

  private canStep(direction: -1 | 1): boolean {
    if (this.wraps) return true;
    return direction > 0 ? this._value < this.maximumValue : this._value > this.minimumValue;
  }

  private step(direction: -1 | 1, event: UIEvent | null): void {
    if (!this.canStep(direction)) return;
    let next = this._value + direction * this.stepValue;
    if (this.wraps) {
      if (next > this.maximumValue) next = this.minimumValue;
      if (next < this.minimumValue) next = this.maximumValue;
    }
    this.value = next;
    this.stepped = true;
    if (this.isContinuous) this.sendActions(UIControlEvents.valueChanged, event);
  }

  override beginTracking(touch: UITouch, event: UIEvent): boolean {
    this.side = touch.location(this).x < this.bounds.size.width / 2 ? -1 : 1;
    this.stepped = false;
    this.step(this.side, event);
    const clock = CAEnvironment.kernel?.clock;
    if (this.autorepeat && clock) {
      const repeat = () => {
        if (this.side === 0) return;
        this.step(this.side as -1 | 1, null);
        this.timer = clock.setTimeout(repeat, REPEAT_INTERVAL);
      };
      this.timer = clock.setTimeout(repeat, REPEAT_DELAY);
    }
    return true;
  }

  override endTracking(_touch: UITouch | null, event: UIEvent | null): void {
    this.stop();
    if (!this.isContinuous && this.stepped) this.sendActions(UIControlEvents.valueChanged, event);
  }

  override cancelTracking(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer != null) CAEnvironment.kernel?.clock.clearTimeout(this.timer);
    this.timer = null;
    this.side = 0;
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const { width, height } = this.bounds.size;
    const r = height / 2;
    const x = ctx.x;
    const y = ctx.y;
    const glyph = (UIColor.label).resolvedColor(traits).rgba;
    const dim = UIColor.tertiaryLabel.resolvedColor(traits).rgba;
    const press = dark ? 0xffffff1f : 0x0000000f;
    ctx.item({ x, y, w: width, h: height }, (w) => {
      w.fillRRect(x, y, width, height, [r, r, r, r], dark ? 0x7676803d : 0x7676801f);
      if (this.side < 0) w.fillRRect(x, y, width / 2, height, [r, 0, 0, r], press);
      if (this.side > 0) w.fillRRect(x + width / 2, y, width / 2, height, [0, r, r, 0], press);
      w.fillRect(x + width / 2 - 0.5, y + 8, 1, height - 16, dark ? 0x54545899 : 0x3c3c434a);
      const cy = y + height / 2;
      const minus = !this.isEnabled || !this.canStep(-1) ? dim : glyph;
      const plus = !this.isEnabled || !this.canStep(1) ? dim : glyph;
      const lx = x + width / 4;
      const rx = x + (width * 3) / 4;
      w.fillRRect(lx - 7, cy - 1, 14, 2, [1, 1, 1, 1], minus);
      w.fillRRect(rx - 7, cy - 1, 14, 2, [1, 1, 1, 1], plus);
      w.fillRRect(rx - 1, cy - 7, 2, 14, [1, 1, 1, 1], plus);
    });
  }
}
