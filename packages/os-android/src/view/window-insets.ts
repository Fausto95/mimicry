/**
 * android.view.WindowInsets (with the androidx WindowInsetsCompat type
 * masks): the system bars, display cutout and IME areas a window's content
 * may want to avoid.
 */
export class Insets {
  static readonly NONE = new Insets(0, 0, 0, 0);
  constructor(readonly left: number, readonly top: number, readonly right: number, readonly bottom: number) {}
  static of(left: number, top: number, right: number, bottom: number): Insets {
    return new Insets(left, top, right, bottom);
  }
  static max(a: Insets, b: Insets): Insets {
    return new Insets(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.max(a.right, b.right), Math.max(a.bottom, b.bottom));
  }
}

export const WindowInsetsType = {
  statusBars: () => 1,
  navigationBars: () => 2,
  captionBar: () => 4,
  ime: () => 8,
  systemGestures: () => 16,
  mandatorySystemGestures: () => 32,
  tappableElement: () => 64,
  displayCutout: () => 128,
  systemBars: () => 1 | 2 | 4,
} as const;

export class WindowInsets {
  static readonly CONSUMED = new WindowInsets(new Map(), true);

  constructor(private readonly byType: ReadonlyMap<number, Insets>, private readonly consumed = false, private readonly hiddenTypes = 0) {}

  /** A copy where the types in `typeMask` are hidden: no insets, though getInsetsIgnoringVisibility still reports them. */
  withHidden(typeMask: number): WindowInsets {
    return new WindowInsets(this.byType, this.consumed, this.hiddenTypes | typeMask);
  }

  static fromBars(statusBar: number, navigationBar: number, left = 0, right = 0, cutout: Insets = Insets.NONE): WindowInsets {
    const map = new Map<number, Insets>();
    map.set(WindowInsetsType.statusBars(), new Insets(0, statusBar, 0, 0));
    map.set(WindowInsetsType.navigationBars(), new Insets(left, 0, right, navigationBar));
    map.set(WindowInsetsType.displayCutout(), cutout);
    map.set(WindowInsetsType.ime(), Insets.NONE);
    return new WindowInsets(map);
  }

  getInsets(typeMask: number): Insets {
    let out = Insets.NONE;
    for (const [type, insets] of this.byType) if (typeMask & type && !(this.hiddenTypes & type)) out = Insets.max(out, insets);
    return out;
  }

  getInsetsIgnoringVisibility(typeMask: number): Insets {
    let out = Insets.NONE;
    for (const [type, insets] of this.byType) if (typeMask & type) out = Insets.max(out, insets);
    return out;
  }

  isVisible(typeMask: number): boolean {
    if (this.hiddenTypes & typeMask) return false;
    const i = this.getInsets(typeMask);
    return i.left > 0 || i.top > 0 || i.right > 0 || i.bottom > 0;
  }

  isConsumed(): boolean {
    return this.consumed;
  }

  getSystemWindowInsetTop(): number {
    return this.getInsets(WindowInsetsType.systemBars()).top;
  }

  getSystemWindowInsetBottom(): number {
    return this.getInsets(WindowInsetsType.systemBars()).bottom;
  }

  getSystemWindowInsetLeft(): number {
    return this.getInsets(WindowInsetsType.systemBars()).left;
  }

  getSystemWindowInsetRight(): number {
    return this.getInsets(WindowInsetsType.systemBars()).right;
  }

  consumeSystemWindowInsets(): WindowInsets {
    return WindowInsets.CONSUMED;
  }
}
