import { OverlayKind, type OverlayRecord } from '@mimicry/protocol';

/**
 * Native controls over the canvas. Like Dactyl's Compose host mounting a real
 * Material text field at the engine's rectangle, the browser host mounts a
 * real <input>/<textarea> where the engine laid out each TextInput, so IME,
 * selection, autofill and accessibility are the browser's own.
 */
export interface OverlayCallbacks {
  textChange(nodeId: number, text: string, selection: { start: number; end: number }): void;
  textEvent(nodeId: number, event: 'focus' | 'blur' | 'submit' | 'keyPress', key?: string): void;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const INPUT_MODES: Record<string, string> = {
  'number-pad': 'numeric', 'decimal-pad': 'decimal', numeric: 'decimal', 'phone-pad': 'tel',
  'email-address': 'email', url: 'url', 'web-search': 'search',
};

export class OverlayLayer {
  private readonly fields = new Map<number, Field>();
  private composing = new Set<number>();

  constructor(private readonly root: HTMLElement, private readonly callbacks: OverlayCallbacks) {}

  update(records: OverlayRecord[]): void {
    const seen = new Set<number>();
    for (const r of records) {
      if (r.kind !== OverlayKind.TextInput) continue;
      seen.add(r.nodeId);
      this.sync(r);
    }
    for (const [id, field] of this.fields) {
      if (!seen.has(id)) {
        field.remove();
        this.fields.delete(id);
      }
    }
  }

  focus(nodeId: number): void {
    const f = this.fields.get(nodeId);
    if (f && document.activeElement !== f) f.focus({ preventScroll: true });
  }

  blur(nodeId: number): void {
    const f = this.fields.get(nodeId);
    if (f && document.activeElement === f) f.blur();
  }

  clear(): void {
    for (const f of this.fields.values()) f.remove();
    this.fields.clear();
  }

  private sync(r: OverlayRecord): void {
    const p = r.props as Record<string, any>;
    let field = this.fields.get(r.nodeId);
    const wantArea = !!p.multiline;
    if (field && (field instanceof HTMLTextAreaElement) !== wantArea) {
      field.remove();
      this.fields.delete(r.nodeId);
      field = undefined;
    }
    if (!field) {
      field = this.create(r.nodeId, wantArea);
      this.fields.set(r.nodeId, field);
      this.root.appendChild(field);
      if (p.autoFocus) queueMicrotask(() => field!.focus({ preventScroll: true }));
    }
    const s = field.style;
    s.left = `${r.x}px`;
    s.top = `${r.y}px`;
    s.width = `${r.w}px`;
    s.height = `${r.h}px`;
    s.font = p.font;
    const clip = p.clip as number[] | undefined;
    s.clipPath = clip && clip.some((v) => v > 0.5) ? `inset(${clip.map((v) => `${Math.max(0, v)}px`).join(' ')})` : '';
    s.padding = (p.padding as number[]).map((v) => `${v}px`).join(' ');
    s.textAlign = p.textAlign === 'center' || p.textAlign === 'right' ? p.textAlign : 'left';
    s.letterSpacing = p.letterSpacing ? `${p.letterSpacing}px` : '';
    s.lineHeight = p.lineHeight ? `${p.lineHeight}px` : '';
    s.setProperty('--mimicry-text', p.color);
    s.caretColor = p.caretHidden ? 'transparent' : p.selectionColor;
    s.setProperty('--mimicry-selection', p.selectionColor);
    if (field instanceof HTMLInputElement) field.type = p.secure ? 'password' : p.keyboardType === 'email-address' ? 'email' : 'text';
    field.inputMode = INPUT_MODES[p.keyboardType] ?? 'text';
    field.readOnly = !p.editable;
    field.placeholder = '';
    field.autocapitalize = p.autoCapitalize === 'none' ? 'off' : p.autoCapitalize;
    field.spellcheck = !!p.autoCorrect;
    field.enterKeyHint = p.returnKeyType === 'default' ? 'enter' : p.returnKeyType;
    if (p.maxLength != null) field.maxLength = p.maxLength;
    else field.removeAttribute('maxlength');
    field.setAttribute('aria-label', p.label ?? '');
    if (p.testID) field.dataset.testid = p.testID;
    // Controlled value: adopt the engine's value unless the user is mid-composition.
    if (!this.composing.has(r.nodeId) && field.value !== p.value) {
      const focused = document.activeElement === field;
      const { selectionStart, selectionEnd } = field;
      field.value = p.value;
      if (focused && selectionStart != null) field.setSelectionRange(Math.min(selectionStart, p.value.length), Math.min(selectionEnd ?? selectionStart, p.value.length));
    }
  }

  private create(nodeId: number, multiline: boolean): Field {
    const field = multiline ? document.createElement('textarea') : document.createElement('input');
    field.className = 'mimicry-native-input';
    field.addEventListener('compositionstart', () => this.composing.add(nodeId));
    field.addEventListener('compositionend', () => {
      this.composing.delete(nodeId);
      this.emitChange(nodeId, field);
    });
    field.addEventListener('input', () => {
      if (!this.composing.has(nodeId)) this.emitChange(nodeId, field);
    });
    field.addEventListener('focus', () => this.callbacks.textEvent(nodeId, 'focus'));
    field.addEventListener('blur', () => this.callbacks.textEvent(nodeId, 'blur'));
    field.addEventListener('keydown', (e) => {
      const key = e as KeyboardEvent;
      this.callbacks.textEvent(nodeId, 'keyPress', key.key === 'Backspace' ? 'Backspace' : key.key);
      if (key.key === 'Enter' && !multiline) {
        key.preventDefault();
        this.callbacks.textEvent(nodeId, 'submit');
      }
    });
    // Keep pointer events from reaching the canvas behind the field.
    field.addEventListener('pointerdown', (e) => e.stopPropagation());
    return field;
  }

  private emitChange(nodeId: number, field: Field): void {
    this.callbacks.textChange(nodeId, field.value, { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 });
  }
}

export const OVERLAY_CSS = `
.mimicry-native-input {
  position: absolute; box-sizing: border-box; margin: 0; border: 0; outline: none; background: transparent;
  color: transparent; resize: none; overflow: hidden; -webkit-appearance: none; appearance: none; pointer-events: auto;
}
.mimicry-native-input:focus { color: var(--mimicry-text); }
.mimicry-native-input::selection { background: var(--mimicry-selection); }
`;
