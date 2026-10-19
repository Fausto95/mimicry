import { OverlayKind, toCss } from '@mimicry/protocol';
import { transformRect, type Kernel, type LayerContext, type TextInputClient } from '@mimicry/os-core';
import type { Context } from '../content/context';
import { Color } from '../graphics/color';
import { MotionEvent } from '../view/motion-event';
import { TextView, type OnEditorActionListener } from './text-view';

/**
 * android.widget.EditText: an editable TextView bound to the keyboard (the
 * input method) — the kernel's text input service, which a browser host
 * serves with a real <input>/<textarea> over the field (from its overlay
 * record) and a headless host serves through the same messages.
 *
 * Focus brings up the keyboard; the host's edits run through TextWatchers;
 * the IME action key reaches the OnEditorActionListener. The Material
 * default background is an underline in colorControlNormal, colorAccent
 * while focused.
 */
export const InputType = {
  TYPE_NULL: 0,
  TYPE_CLASS_TEXT: 1,
  TYPE_CLASS_NUMBER: 2,
  TYPE_CLASS_PHONE: 3,
  TYPE_CLASS_DATETIME: 4,
  TYPE_TEXT_FLAG_CAP_CHARACTERS: 0x1000,
  TYPE_TEXT_FLAG_CAP_WORDS: 0x2000,
  TYPE_TEXT_FLAG_CAP_SENTENCES: 0x4000,
  TYPE_TEXT_FLAG_AUTO_CORRECT: 0x8000,
  TYPE_TEXT_FLAG_MULTI_LINE: 0x20000,
  TYPE_TEXT_FLAG_NO_SUGGESTIONS: 0x80000,
  TYPE_TEXT_VARIATION_URI: 0x10,
  TYPE_TEXT_VARIATION_EMAIL_ADDRESS: 0x20,
  TYPE_TEXT_VARIATION_PASSWORD: 0x80,
  TYPE_TEXT_VARIATION_VISIBLE_PASSWORD: 0x90,
  TYPE_NUMBER_FLAG_DECIMAL: 0x2000,
  TYPE_NUMBER_VARIATION_PASSWORD: 0x10,
} as const;

export const EditorInfo = {
  IME_ACTION_UNSPECIFIED: 0,
  IME_ACTION_NONE: 1,
  IME_ACTION_GO: 2,
  IME_ACTION_SEARCH: 3,
  IME_ACTION_SEND: 4,
  IME_ACTION_NEXT: 5,
  IME_ACTION_DONE: 6,
  IME_ACTION_PREVIOUS: 7,
} as const;

export interface TextWatcher {
  beforeTextChanged?(s: string, start: number, count: number, after: number): void;
  onTextChanged?(s: string, start: number, before: number, count: number): void;
  afterTextChanged?(s: string): void;
}

const IME_KEYS: Record<number, string> = { 2: 'go', 3: 'search', 4: 'send', 5: 'next', 6: 'done', 7: 'previous' };

let nextLocalId = 3_000_000;

export class EditText extends TextView implements TextInputClient {
  private inputType: number = InputType.TYPE_CLASS_TEXT;
  private imeOptions: number = EditorInfo.IME_ACTION_UNSPECIFIED;
  private readonly watchers: TextWatcher[] = [];
  private editorAction: OnEditorActionListener | null = null;
  private selection = { start: 0, end: 0 };
  private registeredWith: Kernel | null = null;
  private maxLength: number | null = null;
  /** the id the keyboard service knows this field by */
  readonly inputId: number;

  constructor(context: Context, inputId?: number) {
    super(context);
    this.inputId = inputId ?? nextLocalId++;
    this.setFocusable(true);
    this.setClickable(true);
    this.setPadding(4, 13, 4, 13);
  }

  // ── content ─────────────────────────────────────────────────────────

  override getText(): string {
    return String(super.getText() ?? '');
  }

  setInputType(type: number): void {
    this.inputType = type;
    this.setSingleLine((type & InputType.TYPE_TEXT_FLAG_MULTI_LINE) === 0);
  }

  getInputType(): number {
    return this.inputType;
  }

  setImeOptions(options: number): void {
    this.imeOptions = options;
  }

  getImeOptions(): number {
    return this.imeOptions;
  }

  /** InputFilter.LengthFilter, the common case */
  setMaxLength(max: number | null): void {
    this.maxLength = max;
  }

  addTextChangedListener(watcher: TextWatcher): void {
    this.watchers.push(watcher);
  }

  removeTextChangedListener(watcher: TextWatcher): void {
    const at = this.watchers.indexOf(watcher);
    if (at >= 0) this.watchers.splice(at, 1);
  }

  setOnEditorActionListener(listener: OnEditorActionListener | null): void {
    this.editorAction = listener;
  }

  setSelection(start: number, end = start): void {
    this.selection = { start, end };
  }

  getSelectionStart(): number {
    return this.selection.start;
  }

  getSelectionEnd(): number {
    return this.selection.end;
  }

  private get secure(): boolean {
    const variation = this.inputType & 0xff0;
    return variation === InputType.TYPE_TEXT_VARIATION_PASSWORD || (this.inputType & 0xf) === InputType.TYPE_CLASS_NUMBER && variation === InputType.TYPE_NUMBER_VARIATION_PASSWORD;
  }

  // ── focus & the keyboard ────────────────────────────────────────────

  protected override onFocusChanged(gainFocus: boolean): void {
    super.onFocusChanged(gainFocus);
    const kernel = this.register();
    if (gainFocus) kernel?.textInput.focus(this.inputId);
    else kernel?.textInput.blur(this.inputId);
    this.invalidate();
  }

  /** Register with the keyboard service of the kernel this field runs on. */
  protected register(): Kernel | null {
    const kernel = this.kernel;
    if (!kernel || this.registeredWith === kernel) return kernel;
    this.registeredWith?.textInput.unregister(this.inputId);
    kernel.textInput.register(this.inputId, this);
    this.registeredWith = kernel;
    return kernel;
  }

  protected override onAttachedToWindow(): void {
    super.onAttachedToWindow();
    this.register();
  }

  protected override onDetachedFromWindow(): void {
    if (this.isFocused()) this.clearFocus();
    this.registeredWith?.textInput.unregister(this.inputId);
    this.registeredWith = null;
    super.onDetachedFromWindow();
  }

  override onTouchEvent(event: MotionEvent): boolean {
    const handled = super.onTouchEvent(event);
    if (event.getActionMasked() === MotionEvent.ACTION_UP && this.isEnabled()) {
      const x = event.getX();
      const y = event.getY();
      if (x >= 0 && y >= 0 && x <= this.getWidth() && y <= this.getHeight()) this.requestFocus();
    }
    return handled || this.isEnabled();
  }

  hostTextChanged(text: string, selection?: { start: number; end: number }): void {
    if (this.maxLength != null && text.length > this.maxLength) text = text.slice(0, this.maxLength);
    const before = this.getText();
    if (text === before) return;
    let start = 0;
    while (start < before.length && start < text.length && before[start] === text[start]) start++;
    const removed = before.length - start;
    const added = text.length - start;
    for (const w of this.watchers) w.beforeTextChanged?.(before, start, removed, added);
    this.setText(text);
    if (selection) this.selection = selection;
    else this.selection = { start: text.length, end: text.length };
    for (const w of this.watchers) w.onTextChanged?.(text, start, removed, added);
    for (const w of this.watchers) w.afterTextChanged?.(text);
  }

  hostEvent(event: 'focus' | 'blur' | 'submit' | 'keyPress', _key?: string): void {
    switch (event) {
      case 'focus':
        this.requestFocus();
        break;
      case 'blur':
        this.clearFocus();
        break;
      case 'submit': {
        const action = this.imeOptions & 0xff || EditorInfo.IME_ACTION_DONE;
        const handled = this.editorAction?.(this, action) ?? false;
        if (!handled && action === EditorInfo.IME_ACTION_DONE) this.clearFocus();
        break;
      }
      case 'keyPress':
        break;
    }
  }

  // ── drawing ─────────────────────────────────────────────────────────

  protected override drawContent(ctx: LayerContext): void {
    const kernel = this.kernel;
    const hostDraws = this.isFocused() && !!kernel?.textInput.hostEditors;
    if (!hostDraws) super.drawContent(ctx);
    this.drawUnderline(ctx);
    if (this.isFocused() && !hostDraws) this.drawCaret(ctx);
    if (kernel?.textInput.hostEditors) this.emitOverlay(ctx, kernel);
  }

  private drawUnderline(ctx: LayerContext): void {
    if (this.getBackground()) return;
    const focused = this.isFocused();
    const color = focused ? this.accent() : this.context.kernel.env.appearance === 'dark' ? 0x938f99ff : 0x79747eff;
    const y = ctx.y + this.getHeight() - 8;
    const w = this.getWidth();
    ctx.item({ x: ctx.x, y: y - 1, w, h: 4 }, (writer) => writer.fillRect(ctx.x + 4, y, w - 8, focused ? 2 : 1, color));
  }

  /** colorAccent (M3 primary) */
  private accent(): number {
    return this.context.kernel.env.appearance === 'dark' ? 0xd0bcffff : 0x6750a4ff;
  }

  private drawCaret(ctx: LayerContext): void {
    const layout = this.getLayout();
    const lines = layout?.getLineCount() ?? 0;
    const last = Math.max(0, lines - 1);
    const text = this.getText();
    const x = ctx.x + this.getCompoundPaddingLeft() + (text && layout ? layout.getLineWidth(last) : 0);
    const lineTop = layout && text ? layout.getLineTop(last) : 0;
    const lineH = layout && text ? layout.getLineBottom(last) - lineTop : this.getTextSize() * 1.17;
    const contentH = this.getHeight() - this.getCompoundPaddingTop() - this.getCompoundPaddingBottom();
    const blockH = layout ? layout.getLineTop(lines) : lineH;
    const offset = this.isSingleLine() ? Math.max(0, (contentH - blockH) / 2) : 0;
    const y = ctx.y + this.getCompoundPaddingTop() + offset + lineTop;
    const color = this.accent();
    ctx.item({ x: x - 1, y, w: 4, h: lineH }, (w) => w.fillRect(x, y + 1, 2, lineH - 2, color));
  }

  private emitOverlay(ctx: LayerContext, kernel: Kernel): void {
    if (!this.isAttachedToWindow()) return;
    const r = transformRect(this.renderNode.windowMatrix(), { x: 0, y: 0, w: this.getWidth(), h: this.getHeight() });
    const v = kernel.viewport;
    const vx = Math.max(0, r.x);
    const vy = Math.max(0, r.y);
    const vw = Math.min(v.width, r.x + r.w) - vx;
    const vh = Math.min(v.height, r.y + r.h) - vy;
    if (vw <= 0 || vh <= 0) return;
    const paint = this.getPaint();
    const capWords = this.inputType & InputType.TYPE_TEXT_FLAG_CAP_WORDS;
    const capChars = this.inputType & InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS;
    const capSentences = this.inputType & InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
    const cls = this.inputType & 0xf;
    const variation = this.inputType & 0xff0;
    ctx.overlay({
      nodeId: this.inputId,
      kind: OverlayKind.TextInput,
      x: r.x, y: r.y, w: r.w, h: r.h,
      props: {
        clip: [vy - r.y, r.x + r.w - (vx + vw), r.y + r.h - (vy + vh), vx - r.x],
        value: this.getText(),
        placeholder: String(this.getHint() ?? ''),
        font: paint.cssFont,
        color: toCss(Color.toRgba(this.getCurrentTextColor())),
        letterSpacing: this.getLetterSpacing() * this.getTextSize(),
        lineHeight: this.getTextSize() * 1.17,
        textAlign: 'left',
        padding: [this.getCompoundPaddingTop(), this.getCompoundPaddingRight(), this.getCompoundPaddingBottom(), this.getCompoundPaddingLeft()],
        multiline: !this.isSingleLine(),
        secure: this.secure,
        editable: this.isEnabled(),
        keyboardType: cls === InputType.TYPE_CLASS_NUMBER ? 'numeric' : cls === InputType.TYPE_CLASS_PHONE ? 'phone-pad' : variation === InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ? 'email-address' : variation === InputType.TYPE_TEXT_VARIATION_URI ? 'url' : 'default',
        autoCapitalize: capChars ? 'characters' : capWords ? 'words' : capSentences ? 'sentences' : 'none',
        autoCorrect: (this.inputType & InputType.TYPE_TEXT_FLAG_AUTO_CORRECT) !== 0,
        maxLength: this.maxLength,
        returnKeyType: IME_KEYS[this.imeOptions & 0xff] ?? 'default',
        selectionColor: toCss(this.accent()),
        caretHidden: false,
        autoFocus: false,
        testID: null,
        label: this.getContentDescription() ?? String(this.getHint() ?? ''),
      },
    });
  }
}
