import { inflate, type LayerContext } from '@mimicry/os-core';
import type { CGRect, CGSize } from '../core-graphics/geometry';
import { NSAttributedStringKey, type NSAttributes } from '../foundation/ns-attributed-string';
import { kernelOf } from '../quartz-core/ca-media-time';
import { perceptualSpring } from '../quartz-core/spring';
import { ControlTween } from './control-tween';
import { drawCenteredText, measureText } from './text-system';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents, UIControlState } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import { UIFont, UIFontWeight } from './ui-font';
import type { UIImage } from './ui-image';
import { UIUserInterfaceStyle } from './ui-trait-collection';

/**
 * UISegmentedControl with the iOS 26 look: a capsule track and a raised
 * capsule for the selected segment that slides (a spring) to the segment
 * the finger lifts on — or follows the finger when it starts on the
 * selected segment. valueChanged fires when the selection changes by touch
 * (not when set in code). Titles are 13 pt, semibold when selected.
 */
export const UISegmentedControlNoSegment = -1;

interface Segment {
  title: string | null;
  image: UIImage | null;
  enabled: boolean;
  /** 0: automatic */
  width: number;
}

const HEIGHT = 32;
const INSET = 2;
const FONT = 13;

export class UISegmentedControl extends UIControl {
  private readonly segments: Segment[] = [];
  private _selected = UISegmentedControlNoSegment;
  isMomentary = false;
  apportionsSegmentWidthsByContent = false;
  selectedSegmentTintColor: UIColor | null = null;
  private readonly textAttributes = new Map<number, NSAttributes>();
  /** the pill's position, in segment index units */
  private readonly pill: ControlTween;
  private pressed = UISegmentedControlNoSegment;
  private dragging = false;

  constructor(items: Array<string | UIImage> = [], frame?: CGRect) {
    super(frame);
    for (const item of items) {
      this.segments.push(typeof item === 'string'
        ? { title: item, image: null, enabled: true, width: 0 }
        : { title: null, image: item, enabled: true, width: 0 });
    }
    this.pill = new ControlTween(0, () => this.setNeedsDisplay());
    if (!frame) this.sizeToFit();
  }

  get numberOfSegments(): number {
    return this.segments.length;
  }

  get selectedSegmentIndex(): number {
    return this._selected;
  }

  set selectedSegmentIndex(index: number) {
    this._selected = index >= 0 && index < this.segments.length ? index : UISegmentedControlNoSegment;
    if (this._selected >= 0) this.pill.set(this._selected);
    this.setNeedsDisplay();
  }

  insertSegment(title: string | UIImage, at: number, _animated = false): void {
    const at_ = Math.max(0, Math.min(at, this.segments.length));
    this.segments.splice(at_, 0, typeof title === 'string'
      ? { title, image: null, enabled: true, width: 0 }
      : { title: null, image: title, enabled: true, width: 0 });
    if (this._selected >= at_) this.selectedSegmentIndex = this._selected + 1;
    this.changed();
  }

  removeSegment(at: number, _animated = false): void {
    if (at < 0 || at >= this.segments.length) return;
    this.segments.splice(at, 1);
    if (this._selected === at) this.selectedSegmentIndex = UISegmentedControlNoSegment;
    else if (this._selected > at) this.selectedSegmentIndex = this._selected - 1;
    this.changed();
  }

  removeAllSegments(): void {
    this.segments.length = 0;
    this._selected = UISegmentedControlNoSegment;
    this.changed();
  }

  setTitle(title: string | null, forSegmentAt: number): void {
    const s = this.segments[forSegmentAt];
    if (!s) return;
    s.title = title;
    s.image = null;
    this.changed();
  }

  titleForSegment(at: number): string | null {
    return this.segments[at]?.title ?? null;
  }

  setImage(image: UIImage | null, forSegmentAt: number): void {
    const s = this.segments[forSegmentAt];
    if (!s) return;
    s.image = image;
    s.title = null;
    this.changed();
  }

  imageForSegment(at: number): UIImage | null {
    return this.segments[at]?.image ?? null;
  }

  setEnabled(enabled: boolean, forSegmentAt: number): void {
    const s = this.segments[forSegmentAt];
    if (s) s.enabled = enabled;
    this.setNeedsDisplay();
  }

  isEnabledForSegment(at: number): boolean {
    return this.segments[at]?.enabled ?? false;
  }

  setWidth(width: number, forSegmentAt: number): void {
    const s = this.segments[forSegmentAt];
    if (s) s.width = Math.max(0, width);
    this.changed();
  }

  widthForSegment(at: number): number {
    return this.segments[at]?.width ?? 0;
  }

  /** setTitleTextAttributes(_:for:) — font and foregroundColor are honored */
  setTitleTextAttributes(attributes: NSAttributes | null, state: UIControlState): void {
    if (attributes) this.textAttributes.set(state, attributes);
    else this.textAttributes.delete(state);
    this.setNeedsDisplay();
  }

  titleTextAttributes(state: UIControlState): NSAttributes | null {
    return this.textAttributes.get(state) ?? null;
  }

  private changed(): void {
    this.invalidateIntrinsicContentSize();
    this.setNeedsDisplay();
  }

  // ── geometry ──────────────────────────────────────────────────────────

  private font(selected: boolean): UIFont {
    const attrs = this.textAttributes.get(selected ? UIControlState.selected : UIControlState.normal) ?? this.textAttributes.get(UIControlState.normal);
    const font = attrs?.[NSAttributedStringKey.font];
    return font instanceof UIFont ? font : UIFont.systemFont(FONT, selected ? UIFontWeight.semibold : UIFontWeight.medium);
  }

  private contentWidth(s: Segment): number {
    if (s.image) return s.image.size.width;
    return measureText(s.title ?? '', this.font(true), kernelOf(this.layer.root.host)).width;
  }

  /** Segment rects (x, width) in the control's bounds. */
  private segmentFrames(width = this.bounds.size.width): Array<{ x: number; w: number }> {
    const n = this.segments.length;
    if (!n) return [];
    const inner = width - INSET * 2;
    const fixed = this.segments.reduce((sum, s) => sum + s.width, 0);
    const auto = this.segments.filter((s) => !s.width);
    let widths: number[];
    if (this.apportionsSegmentWidthsByContent && auto.length) {
      const contents = this.segments.map((s) => (s.width ? 0 : this.contentWidth(s) + 16));
      const total = contents.reduce((a, b) => a + b, 0) || 1;
      widths = this.segments.map((s, i) => s.width || ((inner - fixed) * contents[i]!) / total);
    } else {
      const each = auto.length ? (inner - fixed) / auto.length : 0;
      widths = this.segments.map((s) => s.width || each);
    }
    let x = INSET;
    return widths.map((w) => {
      const r = { x, w };
      x += w;
      return r;
    });
  }

  override sizeThatFits(_size: CGSize): CGSize {
    const widest = this.segments.reduce((m, s) => Math.max(m, s.width || this.contentWidth(s) + 24), 0);
    return { width: Math.ceil(widest * this.segments.length + INSET * 2), height: HEIGHT };
  }

  override get intrinsicContentSize(): CGSize {
    return this.sizeThatFits({ width: Infinity, height: Infinity });
  }

  private segmentAt(x: number): number {
    const frames = this.segmentFrames();
    for (let i = 0; i < frames.length; i++) if (x < frames[i]!.x + frames[i]!.w) return i;
    return frames.length - 1;
  }

  // ── touches ───────────────────────────────────────────────────────────

  override beginTracking(touch: UITouch, _event: UIEvent): boolean {
    const i = this.segmentAt(touch.location(this).x);
    this.pressed = this.segments[i]?.enabled ? i : UISegmentedControlNoSegment;
    // A finger landing on the selected segment can drag it.
    this.dragging = i === this._selected && !this.isMomentary;
    this.setNeedsDisplay();
    return true;
  }

  override continueTracking(touch: UITouch, _event: UIEvent): boolean {
    const i = this.segmentAt(touch.location(this).x);
    if (this.dragging && this.segments[i]?.enabled && Math.round(this.pill.target) !== i) this.slideTo(i);
    this.pressed = this.segments[i]?.enabled ? i : UISegmentedControlNoSegment;
    this.setNeedsDisplay();
    return true;
  }

  override endTracking(touch: UITouch | null, event: UIEvent | null): void {
    const p = touch?.location(this);
    const inside = !!p && p.y >= -20 && p.y <= this.bounds.size.height + 20;
    const i = p ? this.segmentAt(p.x) : UISegmentedControlNoSegment;
    this.pressed = UISegmentedControlNoSegment;
    this.dragging = false;
    if (inside && i >= 0 && this.segments[i]?.enabled) {
      if (this.isMomentary) {
        this._selected = i;
        this.sendActions(UIControlEvents.valueChanged, event);
        this._selected = UISegmentedControlNoSegment;
      } else if (i !== this._selected) {
        const first = this._selected < 0;
        this._selected = i;
        if (first) this.pill.set(i);
        else this.slideTo(i);
        this.sendActions(UIControlEvents.valueChanged, event);
      } else if (Math.round(this.pill.target) !== i) {
        this.slideTo(i);
      }
    } else if (this._selected >= 0) {
      this.slideTo(this._selected);
    }
    this.setNeedsDisplay();
  }

  override cancelTracking(): void {
    this.pressed = UISegmentedControlNoSegment;
    this.dragging = false;
    if (this._selected >= 0) this.slideTo(this._selected);
  }

  private slideTo(i: number): void {
    const spring = perceptualSpring(0.35, 0.1);
    this.pill.animate(i, 0.6, { spring });
  }

  // ── drawing ───────────────────────────────────────────────────────────

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const b = this.bounds.size;
    const h = b.height;
    const r = h / 2;
    const track = { x: ctx.x, y: ctx.y, w: b.width, h };
    const trackColor = dark ? 0x7676803d : 0x7676801f;
    ctx.item(track, (w) => w.fillRRect(track.x, track.y, track.w, track.h, [r, r, r, r], trackColor));
    const frames = this.segmentFrames();
    if (!frames.length) return;
    const showPill = this._selected >= 0 && !this.isMomentary;
    if (showPill) {
      // The pill interpolates between segment frames while it slides.
      const p = Math.max(0, Math.min(frames.length - 1, this.pill.value));
      const a = frames[Math.floor(p)]!;
      const c = frames[Math.ceil(p)]!;
      const t = p - Math.floor(p);
      const px = ctx.x + a.x + (c.x - a.x) * t;
      const pw = a.w + (c.w - a.w) * t;
      const pill = { x: px, y: ctx.y + INSET, w: pw, h: h - INSET * 2 };
      const pr = pill.h / 2;
      const color = this.selectedSegmentTintColor?.resolvedColor(traits).rgba ?? (dark ? 0x636366ff : 0xffffffff);
      ctx.item(inflate(pill, 24), (w) => {
        if (!dark) w.boxShadow(pill.x, pill.y, pill.w, pill.h, [pr, pr, pr, pr], 0x0000001f, 8, 0, 3, 0, false);
        w.fillRRect(pill.x, pill.y, pill.w, pill.h, [pr, pr, pr, pr], color);
      });
    }
    this.segments.forEach((s, i) => {
      const f = frames[i]!;
      const selected = i === this._selected && showPill;
      const attrs = this.textAttributes.get(selected ? UIControlState.selected : UIControlState.normal) ?? this.textAttributes.get(UIControlState.normal);
      const custom = attrs?.[NSAttributedStringKey.foregroundColor];
      let color = custom instanceof UIColor ? custom : UIColor.label;
      if (!s.enabled || !this.isEnabled) color = UIColor.tertiaryLabel;
      else if (i === this.pressed && !selected) color = color.withAlphaComponent(0.5);
      const cx = ctx.x + f.x + f.w / 2;
      const cy = ctx.y + h / 2;
      if (s.image) {
        const size = s.image.size;
        const dest = { origin: { x: cx - size.width / 2, y: cy - size.height / 2 }, size };
        const tint = color.resolvedColor(traits).rgba;
        const image = s.image;
        ctx.item({ x: dest.origin.x, y: dest.origin.y, w: size.width, h: size.height }, (w) => image._draw(w, dest, tint, traits));
      } else if (s.title) {
        drawCenteredText(ctx, s.title, this.font(selected), color, cx, cy, f.w - 8, traits, kernelOf(this.layer.root.host));
      }
    });
  }
}
