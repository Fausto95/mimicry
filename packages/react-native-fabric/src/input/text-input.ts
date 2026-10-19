import type { TextInputClient } from '@mimicry/os-core';
import type { Engine } from '../engine';
import type { HostNode } from '../tree/node';

/**
 * A mounted TextInput as the keyboard service sees it: registered under the
 * node's id (the id React Native's own text input commands use), so the
 * host's edits and key events reach the node like an OS text field's.
 */
export class TextInputBinding implements TextInputClient {
  constructor(private readonly engine: Engine, private readonly node: HostNode) {}

  hostTextChanged(text: string, selection?: { start: number; end: number }): void {
    this.engine.behaviors.textChanged(this.node, text, selection);
  }

  hostEvent(event: 'focus' | 'blur' | 'submit' | 'keyPress', key?: string): void {
    this.engine.focus.hostEvent(this.node, event, key);
  }
}
