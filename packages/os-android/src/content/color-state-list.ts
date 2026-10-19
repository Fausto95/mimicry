/**
 * android.content.res.ColorStateList: colors chosen by view state. Each
 * spec lists state names (StateSet's 'state_pressed', 'state_checked'…);
 * a leading '-' negates one, like a negative attribute id in the
 * framework. The first spec the state satisfies wins; an empty spec
 * matches everything.
 */
export class ColorStateList {
  constructor(readonly states: ReadonlyArray<readonly string[]>, readonly colors: readonly number[]) {
    if (states.length !== colors.length) throw new Error('IllegalArgumentException: states and colors differ in length');
  }

  static valueOf(color: number): ColorStateList {
    return new ColorStateList([[]], [color]);
  }

  static matches(spec: readonly string[], state: readonly string[]): boolean {
    for (const s of spec) {
      if (s.startsWith('-')) {
        if (state.includes(s.slice(1))) return false;
      } else if (!state.includes(s)) return false;
    }
    return true;
  }

  getColorForState(state: readonly string[] | null, defaultColor: number): number {
    const current = state ?? [];
    for (let i = 0; i < this.states.length; i++) {
      if (ColorStateList.matches(this.states[i]!, current)) return this.colors[i]!;
    }
    return defaultColor;
  }

  /** The color for an enabled view in no other state. */
  getDefaultColor(): number {
    return this.getColorForState(['state_enabled'], this.colors[0] ?? 0);
  }

  isStateful(): boolean {
    return this.states.some((s) => s.length > 0);
  }

  isOpaque(): boolean {
    return this.colors.every((c) => ((c >>> 24) & 255) === 255);
  }

  /** The same list with every color's alpha set to `alpha` (0..255). */
  withAlpha(alpha: number): ColorStateList {
    return new ColorStateList(this.states, this.colors.map((c) => ((c & 0x00ffffff) | ((alpha & 255) << 24)) | 0));
  }

  /** Mimicry: alpha multiplied (0..1) rather than replaced. */
  withAlphaMultiplied(factor: number): ColorStateList {
    return new ColorStateList(this.states, this.colors.map((c) => ((c & 0x00ffffff) | (Math.round(((c >>> 24) & 255) * factor) << 24)) | 0));
  }
}
