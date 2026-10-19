import type { Engine } from './engine';
import type { HostNode } from './tree/node';

/**
 * Text input focus. The host mounts a real <input> at each TextInput's
 * rectangle; focus moves between engine and host in both directions.
 */
export class FocusManager {
  focused: HostNode | null = null;

  constructor(private readonly engine: Engine) {}

  focus(node: HostNode): void {
    if (node.kind !== 'input' || node.props.editable === false) return;
    if (this.focused === node) return;
    if (this.focused) this.blur(this.focused);
    this.focused = node;
    this.engine.send({ type: 'focusInput', nodeId: node.id });
    this.engine.events.emit(node, 'onFocus', { target: node.id, text: this.engine.behaviors.inputValue(node) }, this.engine.animator.animationTime);
    this.engine.markPaint();
  }

  blur(node: HostNode): void {
    if (this.focused !== node) return;
    this.focused = null;
    this.engine.send({ type: 'blurInput', nodeId: node.id });
    this.engine.events.emit(node, 'onBlur', { target: node.id, text: this.engine.behaviors.inputValue(node) }, this.engine.animator.animationTime);
    this.engine.events.emit(node, 'onEndEditing', { target: node.id, text: this.engine.behaviors.inputValue(node) }, this.engine.animator.animationTime);
    this.engine.markPaint();
  }

  dismiss(): void {
    if (this.focused) this.blur(this.focused);
  }

  /** Host reported a focus change on its native input. */
  hostEvent(node: HostNode, event: 'focus' | 'blur' | 'submit' | 'keyPress', key?: string): void {
    const time = this.engine.animator.animationTime;
    switch (event) {
      case 'focus':
        if (this.focused !== node) {
          if (this.focused) this.blur(this.focused);
          this.focused = node;
          this.engine.events.emit(node, 'onFocus', { target: node.id }, time);
          this.engine.markPaint();
        }
        break;
      case 'blur':
        if (this.focused === node) {
          this.focused = null;
          this.engine.events.emit(node, 'onBlur', { target: node.id }, time);
          this.engine.events.emit(node, 'onEndEditing', { target: node.id, text: this.engine.behaviors.inputValue(node) }, time);
          this.engine.markPaint();
        }
        break;
      case 'submit':
        this.engine.events.emit(node, 'onSubmitEditing', { target: node.id, text: this.engine.behaviors.inputValue(node) }, time);
        if (node.props.blurOnSubmit !== false && !node.props.multiline && node.props.submitBehavior !== 'submit') this.blur(node);
        break;
      case 'keyPress':
        this.engine.events.emit(node, 'onKeyPress', { key: key ?? '', target: node.id }, time);
        break;
    }
  }

  /** Taps outside the focused input inside a ScrollView dismiss the keyboard by default. */
  tapOutside(target: HostNode): void {
    if (!this.focused) return;
    let n: HostNode | null = target;
    while (n) {
      if (n.kind === 'scroll') {
        const persist = n.props.keyboardShouldPersistTaps;
        if (persist !== 'always' && persist !== 'handled' && persist !== true) this.dismiss();
        return;
      }
      n = n.parent;
    }
  }

  dismissForScroll(scroll: HostNode): void {
    if (this.focused && (scroll.props.keyboardDismissMode === 'on-drag' || scroll.props.keyboardDismissMode === 'interactive')) {
      this.dismiss();
    }
  }
}
