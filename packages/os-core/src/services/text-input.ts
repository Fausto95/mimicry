import type { Kernel } from '../kernel';

/**
 * The keyboard and text editing service. A browser host mounts a real
 * <input>/<textarea> over each focused text field (drawn from the field's
 * overlay record) and reports edits back; a headless host has none, and
 * tests type through the same messages. Text fields (UITextField,
 * UITextView, EditText, frameworks' inputs) register under an id; the
 * host addresses them by it.
 */
export interface TextInputClient {
  /** the host's editor changed the text */
  hostTextChanged(text: string, selection?: { start: number; end: number }): void;
  /** focus, blur, return key or a key press in the host's editor */
  hostEvent(event: 'focus' | 'blur' | 'submit' | 'keyPress', key?: string): void;
}

/** Ids below this are reserved for frameworks that bring their own (React Native node ids). */
const FIRST_SYSTEM_ID = 1_000_000;

export class TextInputService {
  private readonly clients = new Map<number, TextInputClient>();
  private nextId = FIRST_SYSTEM_ID;
  private focusedId: number | null = null;

  constructor(private readonly kernel: Kernel) {
    kernel.on('textChange', (m) => this.clients.get(m.nodeId)?.hostTextChanged(m.text, m.selection));
    kernel.on('textEvent', (m) => this.clients.get(m.nodeId)?.hostEvent(m.event, m.key));
  }

  /** A fresh id for a text field that has none of its own. */
  allocateId(): number {
    return this.nextId++;
  }

  register(id: number, client: TextInputClient): void {
    this.clients.set(id, client);
  }

  unregister(id: number): void {
    this.clients.delete(id);
    if (this.focusedId === id) this.focusedId = null;
  }

  /**
   * Bring up the keyboard for a field (the host focuses its editor). One
   * field holds the keyboard at a time: the one that had it hears a blur.
   */
  focus(id: number): void {
    const previous = this.focusedId;
    this.focusedId = id;
    if (previous != null && previous !== id) this.clients.get(previous)?.hostEvent('blur');
    this.kernel.send({ type: 'focusInput', nodeId: id });
  }

  /** Dismiss the keyboard for a field. */
  blur(id: number): void {
    if (this.focusedId === id) this.focusedId = null;
    this.kernel.send({ type: 'blurInput', nodeId: id });
  }

  get focused(): number | null {
    return this.focusedId;
  }

  /** Whether the host draws the text of focused fields itself (a browser). */
  get hostEditors(): boolean {
    return this.kernel.hostInputs;
  }
}
