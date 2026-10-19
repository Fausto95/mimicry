import { OverlayKind, toCss, type CommandWriter } from '@mimicry/protocol';
import { transformRect, type Kernel, type LayerContext, type TextInputClient } from '@mimicry/os-core';
import type { CGRect } from '../core-graphics/geometry';
import { NSTextAlignment } from './ns-paragraph-style';
import type { NSRange } from '../foundation/ns-attributed-string';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import type { UIEvent, UITouch } from './ui-event';
import { UIFont } from './ui-font';
import { UILabel } from './ui-label';

/**
 * UITextField and UITextView: editable text bound to the keyboard — the
 * kernel's text input service, which a browser host serves with a real
 * <input>/<textarea> over the field (from its overlay record) and a
 * headless host serves through the same messages (tests type into it).
 *
 * Becoming first responder brings up the keyboard (the host focuses its
 * editor); the host's edits come back through the delegate's
 * shouldChangeCharacters and as editingChanged. While the host's editor is
 * up it draws the text, caret and selection; otherwise the field draws its
 * text (or placeholder) and, when editing, a caret.
 */
export enum UITextBorderStyle { none = 0, line = 1, bezel = 2, roundedRect = 3 }
export enum UITextFieldViewMode { never = 0, whileEditing = 1, unlessEditing = 2, always = 3 }
export enum UIKeyboardType {
  default = 0, asciiCapable = 1, numbersAndPunctuation = 2, URL = 3, numberPad = 4, phonePad = 5,
  namePhonePad = 6, emailAddress = 7, decimalPad = 8, twitter = 9, webSearch = 10, asciiCapableNumberPad = 11,
}
export enum UIReturnKeyType {
  default = 0, go = 1, google = 2, join = 3, next = 4, route = 5, search = 6, send = 7, yahoo = 8, done = 9,
  emergencyCall = 10, continue = 11,
}
export enum UITextAutocapitalizationType { none = 0, words = 1, sentences = 2, allCharacters = 3 }
export enum UITextAutocorrectionType { default = 0, no = 1, yes = 2 }

export interface UITextFieldDelegate {
  textFieldShouldBeginEditing?(textField: UITextField): boolean;
  textFieldDidBeginEditing?(textField: UITextField): void;
  textFieldShouldEndEditing?(textField: UITextField): boolean;
  textFieldDidEndEditing?(textField: UITextField): void;
  /** textField(_:shouldChangeCharactersIn:replacementString:) */
  shouldChangeCharacters?(textField: UITextField, range: NSRange, replacement: string): boolean;
  textFieldDidChangeSelection?(textField: UITextField): void;
  textFieldShouldClear?(textField: UITextField): boolean;
  textFieldShouldReturn?(textField: UITextField): boolean;
}

const KEYBOARDS: Record<number, string> = {
  [UIKeyboardType.numberPad]: 'number-pad', [UIKeyboardType.decimalPad]: 'decimal-pad', [UIKeyboardType.phonePad]: 'phone-pad',
  [UIKeyboardType.emailAddress]: 'email-address', [UIKeyboardType.URL]: 'url', [UIKeyboardType.numbersAndPunctuation]: 'numbers-and-punctuation',
  [UIKeyboardType.webSearch]: 'web-search', [UIKeyboardType.asciiCapableNumberPad]: 'number-pad',
};
const RETURN_KEYS: Record<number, string> = {
  [UIReturnKeyType.go]: 'go', [UIReturnKeyType.next]: 'next', [UIReturnKeyType.search]: 'search', [UIReturnKeyType.send]: 'send',
  [UIReturnKeyType.done]: 'done', [UIReturnKeyType.continue]: 'continue', [UIReturnKeyType.join]: 'join', [UIReturnKeyType.route]: 'route',
};
const CAPITALIZATION = ['none', 'words', 'sentences', 'characters'];

export class UITextField extends UIControl implements TextInputClient {
  delegate: UITextFieldDelegate | null = null;
  private _text = '';
  private _placeholder: string | null = null;
  private _font: UIFont = UIFont.systemFont(17);
  private _textColor: UIColor = UIColor.label;
  private _textAlignment = NSTextAlignment.natural;
  borderStyle = UITextBorderStyle.none;
  isSecureTextEntry = false;
  keyboardType = UIKeyboardType.default;
  returnKeyType = UIReturnKeyType.default;
  autocapitalizationType = UITextAutocapitalizationType.sentences;
  autocorrectionType = UITextAutocorrectionType.default;
  clearsOnBeginEditing = false;
  /** Mimicry: the most characters the host's editor accepts (null: unlimited) */
  maxLength: number | null = null;
  selectedRange: NSRange = { location: 0, length: 0 };
  protected multiline = false;
  private editing = false;
  private registeredWith: Kernel | null = null;
  /** the internal label that shows the text or the placeholder (_UITextFieldLabel) */
  private readonly label = new UILabel();
  /** the id the keyboard service knows this field by */
  readonly inputId: number;

  constructor(frame?: CGRect, inputId?: number) {
    super(frame);
    this.inputId = inputId ?? UITextField.nextLocalId++;
    this.label.isUserInteractionEnabled = false;
    this.addSubview(this.label);
    this.syncLabel();
  }

  /** ids for fields created before a kernel is known; re-keyed on registration */
  private static nextLocalId = 2_000_000;

  /** the kernel whose keyboard serves this field (its window's) */
  protected get kernel(): Kernel | null {
    return this.window?.application?.kernel ?? null;
  }

  // ── content ─────────────────────────────────────────────────────────

  get text(): string {
    return this._text;
  }

  set text(text: string | null) {
    this._text = text ?? '';
    this.syncLabel();
  }

  get placeholder(): string | null {
    return this._placeholder;
  }

  set placeholder(p: string | null) {
    this._placeholder = p;
    this.syncLabel();
  }

  get font(): UIFont {
    return this._font;
  }

  set font(font: UIFont | null) {
    this._font = font ?? UIFont.systemFont(17);
    this.syncLabel();
  }

  get textColor(): UIColor {
    return this._textColor;
  }

  set textColor(color: UIColor | null) {
    this._textColor = color ?? UIColor.label;
    this.syncLabel();
  }

  get textAlignment(): NSTextAlignment {
    return this._textAlignment;
  }

  set textAlignment(a: NSTextAlignment) {
    this._textAlignment = a;
    this.syncLabel();
  }

  get hasText(): boolean {
    return this._text.length > 0;
  }

  get isEditing(): boolean {
    return this.editing;
  }

  /** What the label shows: the text (bulleted when secure) or the placeholder. */
  private syncLabel(): void {
    const showPlaceholder = !this._text;
    const shown = showPlaceholder ? this._placeholder ?? '' : this.isSecureTextEntry ? '•'.repeat(Array.from(this._text).length) : this._text;
    this.label.text = shown;
    this.label.font = this._font;
    this.label.textColor = showPlaceholder ? UIColor.placeholderText : this._textColor;
    this.label.textAlignment = this._textAlignment;
    this.label.numberOfLines = this.multiline ? 0 : 1;
    this.setNeedsLayout();
    this.setNeedsDisplay();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    const b = this.bounds.size;
    const inset = this.borderStyle === UITextBorderStyle.roundedRect ? 7 : 0;
    if (this.multiline) {
      this.label.frame = { origin: { x: 5, y: 8 }, size: { width: Math.max(0, b.width - 10), height: Math.max(0, b.height - 16) } };
    } else {
      this.label.frame = { origin: { x: inset, y: 0 }, size: { width: Math.max(0, b.width - inset * 2), height: b.height } };
    }
  }

  // ── editing ─────────────────────────────────────────────────────────

  override get canBecomeFirstResponder(): boolean {
    return this.isEnabled;
  }

  override becomeFirstResponder(): boolean {
    if (this.isFirstResponder) return true;
    if (this.delegate?.textFieldShouldBeginEditing && !this.delegate.textFieldShouldBeginEditing(this)) return false;
    return super.becomeFirstResponder();
  }

  override resignFirstResponder(): boolean {
    if (!this.isFirstResponder) return true;
    if (this.delegate?.textFieldShouldEndEditing && !this.delegate.textFieldShouldEndEditing(this)) return false;
    return super.resignFirstResponder();
  }

  protected override didBecomeFirstResponder(): void {
    this.editing = true;
    if (this.clearsOnBeginEditing) this.text = '';
    this.register()?.textInput.focus(this.inputId);
    this.delegate?.textFieldDidBeginEditing?.(this);
    this.sendActions(UIControlEvents.editingDidBegin);
    this.setNeedsDisplay();
  }

  protected override didResignFirstResponder(): void {
    this.editing = false;
    this.kernel?.textInput.blur(this.inputId);
    this.delegate?.textFieldDidEndEditing?.(this);
    this.sendActions(UIControlEvents.editingDidEnd);
    this.setNeedsDisplay();
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

  override didMoveToWindow(): void {
    super.didMoveToWindow();
    if (this.window) this.register();
    else if (this.registeredWith) {
      if (this.isFirstResponder) this.resignFirstResponder();
      this.registeredWith.textInput.unregister(this.inputId);
      this.registeredWith = null;
    }
  }

  // UIKit brings up the keyboard when a tap ends on the field.
  override touchesEnded(touches: ReadonlySet<UITouch>, event: UIEvent): void {
    super.touchesEnded(touches, event);
    if (this.isEnabled && this.isTouchInside) this.becomeFirstResponder();
  }

  // ── the keyboard (TextInputClient) ──────────────────────────────────

  hostTextChanged(text: string, selection?: { start: number; end: number }): void {
    if (this.maxLength != null && text.length > this.maxLength) text = text.slice(0, this.maxLength);
    if (text === this._text) return;
    const range = changedRange(this._text, text);
    const replacement = text.slice(range.location, text.length - (this._text.length - range.location - range.length));
    if (this.delegate?.shouldChangeCharacters && !this.delegate.shouldChangeCharacters(this, range, replacement)) {
      // Refused: the host's editor goes back to what the field holds.
      this.kernel?.textInput.focus(this.inputId);
      return;
    }
    this._text = text;
    if (selection) this.selectedRange = { location: selection.start, length: selection.end - selection.start };
    this.syncLabel();
    this.sendActions(UIControlEvents.editingChanged);
    if (selection) this.delegate?.textFieldDidChangeSelection?.(this);
  }

  hostEvent(event: 'focus' | 'blur' | 'submit' | 'keyPress', _key?: string): void {
    switch (event) {
      case 'focus':
        this.becomeFirstResponder();
        break;
      case 'blur':
        this.resignFirstResponder();
        break;
      case 'submit':
        if (this.delegate?.textFieldShouldReturn?.(this) !== false) this.sendActions(UIControlEvents.editingDidEndOnExit);
        break;
      case 'keyPress':
        break;
    }
  }

  // ── drawing ─────────────────────────────────────────────────────────

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const b = this.bounds.size;
    if (this.borderStyle === UITextBorderStyle.roundedRect) {
      ctx.item({ x: ctx.x - 1, y: ctx.y - 1, w: b.width + 2, h: b.height + 2 }, (w) => roundedBorder(w, ctx.x, ctx.y, b.width, b.height, this.traitCollection.appearance === 'dark'));
    } else if (this.borderStyle === UITextBorderStyle.line || this.borderStyle === UITextBorderStyle.bezel) {
      const c = UIColor.label.resolvedColor(this.traitCollection).rgba;
      ctx.item({ x: ctx.x - 1, y: ctx.y - 1, w: b.width + 2, h: b.height + 2 }, (w) => w.strokeRRect(ctx.x + 0.5, ctx.y + 0.5, b.width - 1, b.height - 1, [0, 0, 0, 0], 1, c));
    }
  }

  protected override drawLayerOverlay(ctx: LayerContext): void {
    super.drawLayerOverlay(ctx);
    const kernel = this.kernel;
    const hostDraws = this.editing && !!kernel?.textInput.hostEditors;
    this.label.isHidden = hostDraws;
    if (this.editing && !hostDraws) this.drawCaret(ctx);
    if (kernel?.textInput.hostEditors) this.emitOverlay(ctx);
  }

  private drawCaret(ctx: LayerContext): void {
    const lines = this.label.layoutLines;
    const last = lines[lines.length - 1];
    const lf = this.label.frame;
    const x = ctx.x + lf.origin.x + (this._text ? (last?.x ?? 0) + (last?.width ?? 0) : 0);
    const lh = this._font.lineHeight;
    const y = ctx.y + (this.multiline ? lf.origin.y + (last?.y ?? 0) : (this.bounds.size.height - lh) / 2);
    const color = (this.tintColor ?? UIColor.systemBlue).resolvedColor(this.traitCollection).rgba;
    ctx.item({ x: x - 1, y, w: 4, h: lh }, (w) => w.fillRect(x, y + 1, 2, lh - 2, color));
  }

  /** Where the host mounts its editor: the field's window rect, clipped as it shows. */
  private emitOverlay(ctx: LayerContext): void {
    const kernel = this.kernel;
    const window = this.window;
    if (!window) return;
    const r = transformRect(this.layer.windowMatrix(), { x: 0, y: 0, w: this.bounds.size.width, h: this.bounds.size.height });
    const visible = this.visibleWindowRect();
    if (!visible || visible.w <= 0 || visible.h <= 0) return;
    const lf = this.label.frame;
    const traits = this.traitCollection;
    ctx.overlay({
      nodeId: this.inputId,
      kind: OverlayKind.TextInput,
      x: r.x, y: r.y, w: r.w, h: r.h,
      props: {
        clip: [visible.y - r.y, r.x + r.w - (visible.x + visible.w), r.y + r.h - (visible.y + visible.h), visible.x - r.x],
        value: this._text,
        placeholder: this._placeholder ?? '',
        font: this._font._css(kernel),
        color: toCss(this._textColor.resolvedColor(traits).rgba),
        letterSpacing: 0,
        lineHeight: this._font.lineHeight,
        textAlign: this._textAlignment === NSTextAlignment.center ? 'center' : this._textAlignment === NSTextAlignment.right ? 'right' : 'left',
        padding: [lf.origin.y, Math.max(0, r.w - lf.origin.x - lf.size.width), Math.max(0, r.h - lf.origin.y - lf.size.height), lf.origin.x],
        multiline: this.multiline,
        secure: this.isSecureTextEntry,
        editable: this.isEnabled,
        keyboardType: KEYBOARDS[this.keyboardType] ?? 'default',
        autoCapitalize: CAPITALIZATION[this.autocapitalizationType] ?? 'sentences',
        autoCorrect: this.autocorrectionType !== UITextAutocorrectionType.no,
        maxLength: this.maxLength,
        returnKeyType: RETURN_KEYS[this.returnKeyType] ?? 'default',
        selectionColor: toCss((this.tintColor ?? UIColor.systemBlue).resolvedColor(traits).rgba),
        caretHidden: false,
        autoFocus: false,
        testID: this.accessibilityIdentifier,
        label: this.accessibilityLabel ?? this._placeholder,
      },
    });
  }
}

/** UITextView: multi-line, scrolls its text (the host editor scrolls it while editing). */
export class UITextView extends UITextField {
  constructor(frame?: CGRect, inputId?: number) {
    super(frame, inputId);
    this.multiline = true;
    this.text = this.text;
  }
}

function roundedBorder(w: CommandWriter, x: number, y: number, width: number, height: number, dark: boolean): void {
  const r = 5;
  w.strokeRRect(x + 0.25, y + 0.25, width - 0.5, height - 0.5, [r, r, r, r], 0.5, dark ? 0x545458ff : 0xc6c6c8ff);
}

/** The single changed range between two strings (what an edit replaced). */
function changedRange(before: string, after: string): NSRange {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { location: start, length: endB - start };
}
