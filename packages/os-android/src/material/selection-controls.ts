import { mixColor, type Radii } from '@mimicry/protocol';
import type { Context } from '../content/context';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import type { Canvas } from '../graphics/canvas';
import { Color } from '../graphics/color';
import { Gravity } from '../view/gravity';
import { LayoutParams, View } from '../view/view';
import { LinearLayout, LinearLayoutParams } from '../view/view-group';
import { CompoundButton } from '../widget/controls';

/**
 * Material 3 selection controls: CheckBox / MaterialCheckBox, RadioButton /
 * MaterialRadioButton with RadioGroup, and MaterialSwitch — each a
 * CompoundButton (a TextView) whose button draws the M3 control:
 *
 * - check box: an 18 dp box with 2 dp corners, outlined in onSurfaceVariant,
 *   filled with primary and an onPrimary check mark when checked;
 * - radio: a 20 dp ring, primary with a 10 dp dot when checked;
 * - switch: a 52 × 32 track (outlined surfaceContainerHighest → primary)
 *   whose thumb grows from 16 to 24 dp (28 dp while pressed).
 *
 * Buttons sit in a 48 dp touch target; pressing shows a 40 dp state-layer
 * circle. Disabled controls draw at 38 % of onSurface.
 */
const TARGET = 48;

const rgba = (argb: number) => Color.toRgba(argb);

abstract class MaterialCompoundButton extends CompoundButton {
  constructor(context: Context) {
    super(context);
    this.setTextAppearance(TextAppearance.BodyMedium);
    this.setTextColor(context.getTheme().getColor('colorOnSurface'));
    this.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
    this.setMinimumHeight(TARGET);
    this.setFocusable(true);
  }

  protected color(attr: string): number {
    return this.context.getTheme().getColor(attr);
  }

  protected disabled(): number {
    return withAlphaArgb(this.color('colorOnSurface'), 0.38);
  }

  /** The 40 dp state layer behind a control centered at (cx, cy). */
  protected drawStateLayer(canvas: Canvas, cx: number, cy: number, color: number): void {
    if (this.pressedAmount <= 0 || !this.isEnabled()) return;
    const w = canvas.writer;
    w.pathBegin().arc(cx, cy, 20, 0, Math.PI * 2).closePath().fillPath(rgba(withAlphaArgb(color, 0.1 * this.pressedAmount)));
  }
}

export class CheckBox extends MaterialCompoundButton {
  static readonly STATE_UNCHECKED = 0;
  static readonly STATE_CHECKED = 1;
  static readonly STATE_INDETERMINATE = 2;
  private indeterminate = false;

  protected override buttonSize(): { width: number; height: number } {
    return { width: TARGET, height: TARGET };
  }

  /** MaterialCheckBox.setCheckedState: unchecked, checked or indeterminate (a dash). */
  setCheckedState(state: number): void {
    this.indeterminate = state === CheckBox.STATE_INDETERMINATE;
    this.setChecked(state !== CheckBox.STATE_UNCHECKED);
    this.invalidate();
  }

  getCheckedState(): number {
    if (this.indeterminate) return CheckBox.STATE_INDETERMINATE;
    return this.isChecked() ? CheckBox.STATE_CHECKED : CheckBox.STATE_UNCHECKED;
  }

  override setChecked(checked: boolean, animate = true): void {
    if (!checked) this.indeterminate = false;
    super.setChecked(checked, animate);
  }

  protected override drawButton(canvas: Canvas, x: number, y: number, width: number, height: number): void {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const enabled = this.isEnabled();
    const primary = this.color('colorPrimary');
    const outline = this.color('colorOnSurfaceVariant');
    const p = this.progress;
    this.drawStateLayer(canvas, cx, cy, p > 0.5 ? primary : this.color('colorOnSurface'));
    const w = canvas.writer;
    const size = 18;
    const bx = cx - size / 2;
    const by = cy - size / 2;
    const radii: Radii = [2, 2, 2, 2];
    const on = enabled ? primary : this.disabled();
    const off = enabled ? outline : this.disabled();
    if (p < 1) w.strokeRRect(bx + 1, by + 1, size - 2, size - 2, [1, 1, 1, 1], 2, rgba(off));
    if (p > 0) {
      w.save();
      w.alpha(Math.min(1, p * 1.5));
      w.fillRRect(bx, by, size, size, radii, rgba(on));
      const mark = rgba(enabled ? this.color('colorOnPrimary') : this.color('colorSurface'));
      if (this.indeterminate) {
        w.fillRect(bx + 4, cy - 1, (size - 8) * p, 2, mark);
      } else {
        // the check draws itself in as the box fills
        const pts: Array<[number, number]> = [[bx + 3.8, by + 9.2], [bx + 7.2, by + 12.6], [bx + 14.4, by + 5.4]];
        const len1 = Math.hypot(3.4, 3.4);
        const len2 = Math.hypot(7.2, 7.2);
        const t = p * (len1 + len2);
        w.pathBegin().moveTo(pts[0]![0], pts[0]![1]);
        if (t <= len1) {
          const f = t / len1;
          w.lineTo(pts[0]![0] + 3.4 * f, pts[0]![1] + 3.4 * f);
        } else {
          const f = (t - len1) / len2;
          w.lineTo(pts[1]![0], pts[1]![1]).lineTo(pts[1]![0] + 7.2 * f, pts[1]![1] - 7.2 * f);
        }
        w.strokePath(mark, 2, 0, 0);
      }
      w.restore();
    }
  }
}

/** com.google.android.material.checkbox.MaterialCheckBox */
export class MaterialCheckBox extends CheckBox {}

export class RadioButton extends MaterialCompoundButton {
  protected override buttonSize(): { width: number; height: number } {
    return { width: TARGET, height: TARGET };
  }

  /** A radio button cannot be unchecked by tapping it. */
  override toggle(): void {
    if (!this.isChecked()) this.setChecked(true);
  }

  protected override drawButton(canvas: Canvas, x: number, y: number, width: number, height: number): void {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const enabled = this.isEnabled();
    const p = this.progress;
    const primary = this.color('colorPrimary');
    this.drawStateLayer(canvas, cx, cy, p > 0.5 ? primary : this.color('colorOnSurface'));
    const on = enabled ? primary : this.disabled();
    const off = enabled ? this.color('colorOnSurfaceVariant') : this.disabled();
    const ring = rgba(Color.fromRgba(mixColor(rgba(off), rgba(on), p)));
    const w = canvas.writer;
    w.pathBegin().arc(cx, cy, 9, 0, Math.PI * 2).closePath().strokePath(ring, 2, 0, 0);
    if (p > 0) w.pathBegin().arc(cx, cy, 5 * p, 0, Math.PI * 2).closePath().fillPath(rgba(on));
  }
}

/** com.google.android.material.radiobutton.MaterialRadioButton */
export class MaterialRadioButton extends RadioButton {}

export type OnRadioCheckedChangeListener = (group: RadioGroup, checkedId: number) => void;

/**
 * android.widget.RadioGroup: a (vertical by default) LinearLayout whose
 * RadioButtons are mutually exclusive.
 */
export class RadioGroup extends LinearLayout {
  private checkedId = View.NO_ID;
  private listener: OnRadioCheckedChangeListener | null = null;
  private protect = false;

  constructor(context: Context) {
    super(context);
    this.setOrientation(LinearLayout.VERTICAL);
  }

  override addView(child: View, index = -1, params?: LayoutParams): void {
    if (child instanceof RadioButton) {
      if (child.getId() === View.NO_ID) child.setId(View.generateViewId());
      if (child.isChecked()) {
        this.protect = true;
        if (this.checkedId !== View.NO_ID) this.setCheckedStateForView(this.checkedId, false);
        this.protect = false;
        this.setCheckedId(child.getId());
      }
      child.setOnCheckedChangeWidgetListener((button, isChecked) => {
        if (this.protect) return;
        this.protect = true;
        if (isChecked && this.checkedId !== View.NO_ID && this.checkedId !== button.getId()) this.setCheckedStateForView(this.checkedId, false);
        this.protect = false;
        if (isChecked) this.setCheckedId(button.getId());
        else if (this.checkedId === button.getId()) this.setCheckedId(View.NO_ID);
      });
    }
    super.addView(child, index, params ?? new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
  }

  private setCheckedStateForView(id: number, checked: boolean): void {
    const v = this.findViewById(id);
    if (v instanceof RadioButton) v.setChecked(checked);
  }

  private setCheckedId(id: number): void {
    const changed = id !== this.checkedId;
    this.checkedId = id;
    if (changed) this.listener?.(this, id);
  }

  /** Check the button with this id (-1 clears). */
  check(id: number): void {
    if (id !== View.NO_ID && id === this.checkedId) return;
    if (this.checkedId !== View.NO_ID) {
      this.protect = true;
      this.setCheckedStateForView(this.checkedId, false);
      this.protect = false;
    }
    if (id !== View.NO_ID) {
      this.protect = true;
      this.setCheckedStateForView(id, true);
      this.protect = false;
    }
    this.setCheckedId(id);
  }

  clearCheck(): void {
    this.check(View.NO_ID);
  }

  getCheckedRadioButtonId(): number {
    return this.checkedId;
  }

  setOnCheckedChangeListener(listener: OnRadioCheckedChangeListener | null): void {
    this.listener = listener;
  }
}

/**
 * com.google.android.material.materialswitch.MaterialSwitch: the M3 switch,
 * label at the start and the switch at the end.
 */
export class MaterialSwitch extends MaterialCompoundButton {
  static readonly TRACK = { width: 52, height: 32 } as const;

  constructor(context: Context) {
    super(context);
    this.toggleDuration = 250;
  }

  /** The switch sits at the end, after the label. */
  override getCompoundPaddingRight(): number {
    return super.getCompoundPaddingRight() + MaterialSwitch.TRACK.width + (this.length() ? 16 : 0);
  }

  protected override onDraw(canvas: Canvas): void {
    super.onDraw(canvas);
    const t = MaterialSwitch.TRACK;
    const x = this.getWidth() - this.getPaddingRight() - t.width;
    const y = (this.getHeight() - t.height) / 2;
    this.drawSwitch(canvas, x, y);
  }

  private drawSwitch(canvas: Canvas, x: number, y: number): void {
    const t = MaterialSwitch.TRACK;
    const p = this.progress;
    const enabled = this.isEnabled();
    const w = canvas.writer;
    const mix = (a: number, b: number) => Color.fromRgba(mixColor(rgba(a), rgba(b), p));
    const trackOff = this.color('colorSurfaceContainerHighest');
    const trackOn = this.color('colorPrimary');
    const outline = this.color('colorOutline');
    const thumbOff = outline;
    const thumbOn = this.color('colorOnPrimary');
    const r = t.height / 2;
    const fade = enabled ? 1 : 0.38;
    w.save();
    if (!enabled) w.alpha(fade);
    w.fillRRect(x, y, t.width, t.height, [r, r, r, r], rgba(enabled ? mix(trackOff, trackOn) : mix(trackOff, this.color('colorOnSurface'))));
    if (p < 1) {
      const a = Math.round(255 * (1 - p));
      w.strokeRRect(x + 1, y + 1, t.width - 2, t.height - 2, [r - 1, r - 1, r - 1, r - 1], 2, ((rgba(outline) & 0xffffff00) | a) >>> 0);
    }
    // the thumb grows as it travels, and more while pressed
    const base = 16 + 8 * p;
    const size = base + (28 - base) * this.pressedAmount;
    const cx = x + 16 + (t.width - 32) * p;
    const cy = y + t.height / 2;
    if (this.pressedAmount > 0 && enabled) {
      w.pathBegin().arc(cx, cy, 20, 0, Math.PI * 2).closePath().fillPath(rgba(withAlphaArgb(p > 0.5 ? trackOn : this.color('colorOnSurface'), 0.1 * this.pressedAmount)));
    }
    const thumb = enabled ? mix(thumbOff, thumbOn) : mix(this.color('colorOnSurface'), this.color('colorSurface'));
    w.pathBegin().arc(cx, cy, size / 2, 0, Math.PI * 2).closePath().fillPath(rgba(thumb));
    w.restore();
  }
}
