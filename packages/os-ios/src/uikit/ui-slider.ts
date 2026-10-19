import { inflate, uikitEase, type LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { ControlTween } from './control-tween';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import type { UIImage } from './ui-image';
import { UIUserInterfaceStyle } from './ui-trait-collection';

/**
 * UISlider with the iOS 26 look: a 6 pt capsule track, filled with the
 * minimum track tint up to the value, and the Liquid Glass capsule thumb
 * (37×24, like the switch's). Dragging the thumb (it must start on it,
 * with UIKit's generous slop) moves the value and sends valueChanged
 * continuously, or once at the end when not `isContinuous`.
 */
const TRACK = 6;
const THUMB_W = 37;
const THUMB_H = 24;
const HEIGHT = 28;

export class UISlider extends UIControl {
  private _value = 0;
  private _minimumValue = 0;
  private _maximumValue = 1;
  isContinuous = true;
  minimumTrackTintColor: UIColor | null = null;
  maximumTrackTintColor: UIColor | null = null;
  thumbTintColor: UIColor | null = null;
  minimumValueImage: UIImage | null = null;
  maximumValueImage: UIImage | null = null;
  private readonly shown: ControlTween;
  private grab = 0;
  private changedWhileTracking = false;

  constructor(frame?: CGRect) {
    super(frame);
    this.shown = new ControlTween(0, () => this.setNeedsDisplay());
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this.setValue(v, false);
  }

  setValue(v: number, animated: boolean): void {
    this._value = Math.max(this._minimumValue, Math.min(this._maximumValue, v));
    if (animated) this.shown.animate(this._value, 0.25, { curve: uikitEase });
    else this.shown.set(this._value);
    this.setNeedsDisplay();
  }

  get minimumValue(): number {
    return this._minimumValue;
  }

  set minimumValue(v: number) {
    this._minimumValue = v;
    if (this._maximumValue < v) this._maximumValue = v;
    this.setValue(this._value, false);
  }

  get maximumValue(): number {
    return this._maximumValue;
  }

  set maximumValue(v: number) {
    this._maximumValue = v;
    if (this._minimumValue > v) this._minimumValue = v;
    this.setValue(this._value, false);
  }

  override sizeThatFits(size: CGSize): CGSize {
    return { width: Number.isFinite(size.width) && size.width > 0 ? size.width : 118, height: HEIGHT };
  }

  override get intrinsicContentSize(): CGSize {
    return { width: -1, height: HEIGHT };
  }

  /** trackRect(forBounds:) */
  trackRect(bounds: CGRect = this.bounds): CGRect {
    return { origin: { x: bounds.origin.x, y: bounds.origin.y + (bounds.size.height - TRACK) / 2 }, size: { width: bounds.size.width, height: TRACK } };
  }

  /** thumbRect(forBounds:trackRect:value:) */
  thumbRect(bounds: CGRect, track: CGRect, value: number): CGRect {
    const span = this._maximumValue - this._minimumValue;
    const f = span > 0 ? (value - this._minimumValue) / span : 0;
    const x = track.origin.x + (track.size.width - THUMB_W) * f;
    return { origin: { x, y: bounds.origin.y + (bounds.size.height - THUMB_H) / 2 }, size: { width: THUMB_W, height: THUMB_H } };
  }

  private valueAt(x: number): number {
    const track = this.trackRect();
    const f = (x - track.origin.x - THUMB_W / 2) / Math.max(1, track.size.width - THUMB_W);
    return this._minimumValue + Math.max(0, Math.min(1, f)) * (this._maximumValue - this._minimumValue);
  }

  override beginTracking(touch: UITouch, _event: UIEvent): boolean {
    const p = touch.location(this);
    const thumb = this.thumbRect(this.bounds, this.trackRect(), this._value);
    // The thumb takes touches a little outside itself; elsewhere on the track, nothing happens.
    const inThumb = p.x >= thumb.origin.x - 12 && p.x <= thumb.origin.x + thumb.size.width + 12;
    if (!inThumb) return false;
    this.grab = p.x - (thumb.origin.x + THUMB_W / 2);
    this.changedWhileTracking = false;
    this.setNeedsDisplay();
    return true;
  }

  override continueTracking(touch: UITouch, event: UIEvent): boolean {
    const v = this.valueAt(touch.location(this).x - this.grab);
    if (v !== this._value) {
      this.setValue(v, false);
      this.changedWhileTracking = true;
      if (this.isContinuous) this.sendActions(UIControlEvents.valueChanged, event);
    }
    return true;
  }

  override endTracking(_touch: UITouch | null, event: UIEvent | null): void {
    if (!this.isContinuous && this.changedWhileTracking) this.sendActions(UIControlEvents.valueChanged, event);
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const track = this.trackRect();
    const thumb = this.thumbRect(this.bounds, track, this.shown.value);
    const tx = ctx.x + track.origin.x;
    const ty = ctx.y + track.origin.y;
    const tw = track.size.width;
    const r = TRACK / 2;
    const fillTo = thumb.origin.x + THUMB_W / 2;
    const min = (this.minimumTrackTintColor ?? this.tintColor ?? UIColor.tintColor).resolvedColor(traits).rgba;
    const max = this.maximumTrackTintColor?.resolvedColor(traits).rgba ?? (dark ? 0x7878805c : 0x78788033);
    const disabled = !this.isEnabled;
    ctx.item({ x: tx, y: ty, w: tw, h: TRACK }, (w) => {
      if (disabled) w.alpha(0.5);
      w.fillRRect(tx, ty, tw, TRACK, [r, r, r, r], max);
      if (fillTo > 0) w.fillRRect(tx, ty, Math.min(tw, fillTo), TRACK, [r, r, r, r], min);
    });
    const thumbBox = { x: ctx.x + thumb.origin.x, y: ctx.y + thumb.origin.y, w: THUMB_W, h: THUMB_H };
    const tr = THUMB_H / 2;
    const thumbColor = this.thumbTintColor?.resolvedColor(traits).rgba ?? 0xffffffff;
    // Pressed, the glass thumb swells a little (iOS 26).
    const grow = this.isTracking ? 3 : 0;
    const box = inflate(thumbBox, grow);
    ctx.item(inflate(thumbBox, 24), (w) => {
      if (disabled) w.alpha(0.5);
      w.boxShadow(box.x, box.y, box.w, box.h, [tr + grow, tr + grow, tr + grow, tr + grow], 0x00000026, 8, 0, 2, 0, false);
      w.fillRRect(box.x, box.y, box.w, box.h, [tr + grow, tr + grow, tr + grow, tr + grow], thumbColor);
    });
  }
}
