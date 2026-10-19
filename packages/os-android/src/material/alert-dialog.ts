import type { Context } from '../content/context';
import { ColorStateList } from '../content/color-state-list';
import { TextAppearance, withAlphaArgb } from '../content/theme';
import { RippleDrawable } from '../graphics/drawable';
import { MaterialIconDrawable } from '../graphics/icon-drawable';
import { Gravity } from '../view/gravity';
import { MeasureSpec, LayoutParams, View } from '../view/view';
import { FrameLayoutParams, LinearLayout, LinearLayoutParams } from '../view/view-group';
import { ScrollView } from '../widget/scroll-view';
import { TextView } from '../widget/text-view';
import { ImageView } from '../widget/image-view';
import { Dialog, DialogInterfaceButtons, type DialogClickListener, type DialogInterface, type DialogMultiChoiceListener } from '../app/dialog';
import type { CharSequence } from '../text/spanned';
import { ButtonStyle, MaterialButton } from './button';
import { CheckBox, RadioButton } from './selection-controls';
import { MaterialShapeDrawable } from './shape';

/**
 * androidx.appcompat.app.AlertDialog built by AlertDialog.Builder or
 * MaterialAlertDialogBuilder, in the Material 3 dialog style: a
 * surfaceContainerHigh panel with 28 dp corners, 24 dp from the screen's
 * sides (at most 560 dp wide), an optional centered icon, a HeadlineSmall
 * title, a BodyMedium message in onSurfaceVariant, then the list (plain,
 * single- or multi-choice) or a custom view, and text buttons aligned to
 * the end — positive last, the neutral button at the start.
 *
 * Plain items dismiss the dialog when tapped; choice items do not. Every
 * button dismisses after its listener runs.
 */
interface Params {
  title: CharSequence | null;
  message: CharSequence | null;
  icon: string | null;
  view: View | null;
  items: CharSequence[] | null;
  itemsListener: DialogClickListener | null;
  choice: 'none' | 'single' | 'multi';
  checkedItem: number;
  checkedItems: boolean[] | null;
  multiListener: DialogMultiChoiceListener | null;
  buttons: Map<number, { text: CharSequence; listener: DialogClickListener | null }>;
  cancelable: boolean;
  onCancel: ((dialog: DialogInterface) => void) | null;
  onDismiss: ((dialog: DialogInterface) => void) | null;
}

/** The panel caps its width at 560 dp (and its height at the window minus 2 × 80 dp). */
class DialogPanel extends LinearLayout {
  protected override onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
    const width = Math.min(MeasureSpec.getSize(widthMeasureSpec), 560);
    super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightMeasureSpec);
  }
}

/** AlertDialog.Builder (androidx.appcompat). */
export class AlertDialogBuilder {
  protected readonly params: Params = {
    title: null,
    message: null,
    icon: null,
    view: null,
    items: null,
    itemsListener: null,
    choice: 'none',
    checkedItem: -1,
    checkedItems: null,
    multiListener: null,
    buttons: new Map(),
    cancelable: true,
    onCancel: null,
    onDismiss: null,
  };

  constructor(protected readonly context: Context) {}

  getContext(): Context {
    return this.context;
  }

  setTitle(title: CharSequence | null): this {
    this.params.title = title;
    return this;
  }

  setMessage(message: CharSequence | null): this {
    this.params.message = message;
    return this;
  }

  /** A Material Symbols icon name shown above a centered title. */
  setIcon(icon: string | null): this {
    this.params.icon = icon;
    return this;
  }

  setView(view: View | null): this {
    this.params.view = view;
    return this;
  }

  setItems(items: CharSequence[], listener: DialogClickListener | null): this {
    this.params.items = items;
    this.params.itemsListener = listener;
    this.params.choice = 'none';
    return this;
  }

  setSingleChoiceItems(items: CharSequence[], checkedItem: number, listener: DialogClickListener | null): this {
    this.params.items = items;
    this.params.itemsListener = listener;
    this.params.checkedItem = checkedItem;
    this.params.choice = 'single';
    return this;
  }

  setMultiChoiceItems(items: CharSequence[], checkedItems: boolean[] | null, listener: DialogMultiChoiceListener | null): this {
    this.params.items = items;
    this.params.checkedItems = checkedItems ?? items.map(() => false);
    this.params.multiListener = listener;
    this.params.choice = 'multi';
    return this;
  }

  setPositiveButton(text: CharSequence, listener: DialogClickListener | null): this {
    this.params.buttons.set(AlertDialog.BUTTON_POSITIVE, { text, listener });
    return this;
  }

  setNegativeButton(text: CharSequence, listener: DialogClickListener | null): this {
    this.params.buttons.set(AlertDialog.BUTTON_NEGATIVE, { text, listener });
    return this;
  }

  setNeutralButton(text: CharSequence, listener: DialogClickListener | null): this {
    this.params.buttons.set(AlertDialog.BUTTON_NEUTRAL, { text, listener });
    return this;
  }

  setCancelable(cancelable: boolean): this {
    this.params.cancelable = cancelable;
    return this;
  }

  setOnCancelListener(listener: ((dialog: DialogInterface) => void) | null): this {
    this.params.onCancel = listener;
    return this;
  }

  setOnDismissListener(listener: ((dialog: DialogInterface) => void) | null): this {
    this.params.onDismiss = listener;
    return this;
  }

  create(): AlertDialog {
    const dialog = new AlertDialog(this.context, { ...this.params, buttons: new Map(this.params.buttons) });
    dialog.ensureCreated();
    return dialog;
  }

  show(): AlertDialog {
    const dialog = this.create();
    dialog.show();
    return dialog;
  }
}

export class AlertDialog extends Dialog {
  static readonly BUTTON_POSITIVE = DialogInterfaceButtons.BUTTON_POSITIVE;
  static readonly BUTTON_NEGATIVE = DialogInterfaceButtons.BUTTON_NEGATIVE;
  static readonly BUTTON_NEUTRAL = DialogInterfaceButtons.BUTTON_NEUTRAL;
  static readonly Builder = AlertDialogBuilder;

  private readonly buttons = new Map<number, MaterialButton>();
  private messageView: TextView | null = null;
  private titleView: TextView | null = null;
  private listView: LinearLayout | null = null;

  /** @internal use a Builder */
  constructor(context: Context, private readonly params: Params) {
    super(context);
    this.setCancelable(params.cancelable);
    if (params.onCancel) this.setOnCancelListener(params.onCancel);
    if (params.onDismiss) this.setOnDismissListener(params.onDismiss);
  }

  getButton(which: number): MaterialButton | null {
    this.ensureCreated();
    return this.buttons.get(which) ?? null;
  }

  /** The list of items (a LinearLayout of rows) when the dialog has one. */
  getListView(): LinearLayout | null {
    this.ensureCreated();
    return this.listView;
  }

  setMessage(message: CharSequence): void {
    this.params.message = message;
    this.messageView?.setText(message);
  }

  override setTitle(title: string | null): void {
    super.setTitle(title);
    this.params.title = title;
    this.titleView?.setText(title);
  }

  protected override onCreate(): void {
    const context = this.context;
    const theme = context.getTheme();
    const p = this.params;
    const panel = new DialogPanel(context);
    panel.setOrientation(LinearLayout.VERTICAL);
    const shape = new MaterialShapeDrawable();
    shape.setCornerSize(28);
    shape.setFillColor(ColorStateList.valueOf(theme.getColor('colorSurfaceContainerHigh')));
    panel.setBackground(shape);
    panel.setElevation(6);
    panel.setClipToOutline(true);
    panel.setPadding(0, 24, 0, 0);
    const side = 24;
    const block = (view: View, top = 0, bottom = 0, gravity = -1) => {
      const lp = new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
      lp.setMargins(side, top, side, bottom);
      if (gravity >= 0) lp.gravity = gravity;
      panel.addView(view, -1, lp);
    };
    if (p.icon) {
      const icon = new ImageView(context);
      icon.setImageDrawable(new MaterialIconDrawable(context, p.icon, 24, theme.getColor('colorSecondary')));
      const lp = new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
      lp.gravity = Gravity.CENTER_HORIZONTAL;
      lp.setMargins(0, 0, 0, 16);
      panel.addView(icon, -1, lp);
    }
    if (p.title) {
      const title = new TextView(context);
      title.setText(p.title);
      title.setTextAppearance(TextAppearance.HeadlineSmall);
      title.setTextColor(theme.getColor('colorOnSurface'));
      if (p.icon) title.setGravity(Gravity.CENTER_HORIZONTAL);
      this.titleView = title;
      block(title, 0, 16);
    }
    if (p.message) {
      const message = new TextView(context);
      message.setText(p.message);
      message.setTextAppearance(TextAppearance.BodyMedium);
      message.setTextColor(theme.getColor('colorOnSurfaceVariant'));
      this.messageView = message;
      const scroll = new ScrollView(context);
      scroll.addView(message);
      block(scroll, 0, p.items ? 16 : 0);
    }
    if (p.items) {
      const list = this.buildList(p);
      this.listView = list;
      const scroll = new ScrollView(context);
      scroll.addView(list);
      const lp = new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
      lp.weight = 1;
      panel.addView(scroll, -1, lp);
    }
    if (p.view) {
      const lp = new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
      panel.addView(p.view, -1, lp);
    }
    if (p.buttons.size) {
      const bar = new LinearLayout(context);
      bar.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
      bar.setPadding(side - 4, 0, side - 4, 0);
      const make = (which: number) => {
        const spec = p.buttons.get(which);
        if (!spec) return null;
        const b = new MaterialButton(context, ButtonStyle.TEXT);
        b.setText(spec.text);
        b.setOnClickListener(() => {
          spec.listener?.(this, which);
          this.dismiss();
        });
        this.buttons.set(which, b);
        return b;
      };
      const neutral = make(AlertDialog.BUTTON_NEUTRAL);
      const negative = make(AlertDialog.BUTTON_NEGATIVE);
      const positive = make(AlertDialog.BUTTON_POSITIVE);
      if (neutral) {
        bar.addView(neutral);
        const spacer = new View(context);
        bar.addView(spacer, -1, new LinearLayoutParams(0, 1, 1));
      }
      for (const b of [negative, positive]) {
        if (!b) continue;
        const lp = new LinearLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        lp.setMargins(8, 0, 0, 0);
        bar.addView(b, -1, lp);
      }
      const lp = new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
      lp.setMargins(0, 16, 0, 12);
      panel.addView(bar, -1, lp);
    } else {
      panel.setPadding(0, 24, 0, 24);
    }
    const lp = new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER);
    lp.setMargins(24, 80, 24, 80);
    this.setContentView(panel, lp);
    this.getWindow().setLayout(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
    this.getWindow().getDecorView().setLayoutParams(new FrameLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    // the decor is the touch area; the panel is inside its margins
    this.panelView = panel;
  }

  private panelView: View | null = null;

  /** @internal the M3 panel (tests) */
  get panel(): View | null {
    return this.panelView;
  }

  private buildList(p: Params): LinearLayout {
    const context = this.context;
    const theme = context.getTheme();
    const list = new LinearLayout(context);
    list.setOrientation(LinearLayout.VERTICAL);
    const items = p.items ?? [];
    const radios: RadioButton[] = [];
    items.forEach((label, which) => {
      let row: View;
      if (p.choice === 'single') {
        const radio = new RadioButton(context);
        radio.setText(label);
        radio.setTextAppearance(TextAppearance.BodyLarge);
        radio.setTextColor(theme.getColor('colorOnSurfaceVariant'));
        radio.setChecked(which === p.checkedItem, false);
        radio.setPadding(12, 0, 24, 0);
        radio.setOnClickListener(() => {
          for (const r of radios) if (r !== radio) r.setChecked(false);
          p.checkedItem = which;
          p.itemsListener?.(this, which);
        });
        radios.push(radio);
        row = radio;
      } else if (p.choice === 'multi') {
        const box = new CheckBox(context);
        box.setText(label);
        box.setTextAppearance(TextAppearance.BodyLarge);
        box.setTextColor(theme.getColor('colorOnSurfaceVariant'));
        box.setChecked(!!p.checkedItems?.[which], false);
        box.setPadding(12, 0, 24, 0);
        box.setOnCheckedChangeListener((_b, checked) => {
          if (p.checkedItems) p.checkedItems[which] = checked;
          p.multiListener?.(this, which, checked);
        });
        row = box;
      } else {
        const text = new TextView(context);
        text.setText(label);
        text.setTextAppearance(TextAppearance.BodyLarge);
        text.setTextColor(theme.getColor('colorOnSurfaceVariant'));
        text.setGravity(Gravity.CENTER_VERTICAL);
        text.setMinimumHeight(48);
        text.setPadding(24, 0, 24, 0);
        text.setBackground(new RippleDrawable(withAlphaArgb(theme.getColor('colorOnSurface'), 0.1)));
        text.setOnClickListener(() => {
          p.itemsListener?.(this, which);
          this.dismiss();
        });
        row = text;
      }
      list.addView(row, -1, new LinearLayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
    });
    return list;
  }
}

/** com.google.android.material.dialog.MaterialAlertDialogBuilder */
export class MaterialAlertDialogBuilder extends AlertDialogBuilder {}
