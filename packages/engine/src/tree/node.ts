import type { Node as YogaNode } from 'yoga-layout/load';
import { MeasureMode } from 'yoga-layout/load';
import type { Engine } from '../engine';
import { applyYogaStyle } from '../layout/yoga-style';
import { flattenStyle, LAYOUT_KEYS, TEXT_MEASURE_KEYS, type FlatStyle } from '../style/flatten';
import type { TextLayout } from '../text/text-layout';
import type { ScrollState } from '../input/scroll';

/** Host component names emitted by @mimicry/react-native. */
export const HostType = {
  View: 'm-view',
  Text: 'm-text',
  Image: 'm-image',
  ScrollView: 'm-scroll',
  TextInput: 'm-input',
  Switch: 'm-switch',
  ActivityIndicator: 'm-activity',
  Path: 'm-path',
  Modal: 'm-modal',
} as const;

export type NodeKind =
  | 'root' | 'view' | 'text' | 'virtual-text' | 'raw-text' | 'image' | 'scroll'
  | 'input' | 'switch' | 'activity' | 'path' | 'modal';

const KIND_BY_TYPE: Record<string, NodeKind> = {
  [HostType.View]: 'view',
  [HostType.Text]: 'text',
  [HostType.Image]: 'image',
  [HostType.ScrollView]: 'scroll',
  [HostType.TextInput]: 'input',
  [HostType.Switch]: 'switch',
  [HostType.ActivityIndicator]: 'activity',
  [HostType.Path]: 'path',
  [HostType.Modal]: 'modal',
};

export function kindForType(type: string, insideText: boolean): NodeKind {
  const kind = KIND_BY_TYPE[type];
  if (!kind) throw new Error(`Mimicry: unknown host component "${type}"`);
  if (kind === 'text' && insideText) return 'virtual-text';
  return kind;
}

let nextId = 1;
/** non-style props that change a leaf's intrinsic size */
const MEASURE_PROPS = [
  'numberOfLines', 'ellipsizeMode', 'allowFontScaling', 'maxFontSizeMultiplier', 'value', 'defaultValue',
  'placeholder', 'multiline', 'secureTextEntry', 'source', 'size',
];
const EMPTY: FlatStyle = Object.freeze({}) as FlatStyle;

export type Props = Record<string, any>;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Runs an exit animation; calls `done` when the node may be removed. */
export type ExitAnimation = (done: () => void) => void;
/** Called when Yoga moves or resizes a laid-out node; may animate node.x/y/w/h itself. */
export type LayoutTransition = (from: Frame, to: Frame) => void;

/**
 * A node of the retained view tree (the "shadow tree"). It owns its Yoga node,
 * its last computed frame and any native behavior state (scroll position,
 * control animation). It is also the public instance React hands to refs,
 * so it exposes React Native's imperative API: measure, setNativeProps, focus…
 */
export class HostNode {
  readonly id = nextId++;
  readonly engine: Engine;
  readonly type: string;
  readonly kind: NodeKind;
  props: Props;
  /** flattened props.style */
  style: FlatStyle = EMPTY;
  /** values written by Animated / setNativeProps, layered over style */
  overrides: FlatStyle | null = null;
  private computedCache: FlatStyle | null = null;
  private appliedLayoutStyle: FlatStyle | null = null;

  parent: HostNode | null = null;
  children: HostNode[] = [];
  yoga: YogaNode | null = null;

  /** frame relative to the parent's border box, from Yoga */
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  /** set once a layout has been read */
  laidOut = false;

  /** raw text content for 'raw-text' nodes */
  text = '';
  /** padding + border, from the last layout */
  insets = { left: 0, top: 0, right: 0, bottom: 0 };
  /** cached attributed layouts for 'text'/'input' nodes, keyed by constraint width */
  textLayout: Map<number, TextLayout> | null = null;
  /** Suspense hide */
  hidden = false;
  /** native behavior state (scroll, switch animation, ripple, presentation…) */
  scroll: ScrollState | null = null;
  native: Record<string, any> = {};
  /** React fiber, for the inspector's component names */
  fiber: unknown = null;
  mounted = false;

  /**
   * Layout-animation hooks installed by the React Native layer (Reanimated's
   * `exiting` and `layout` props). See tree/exit.ts and layout/layout.ts.
   */
  exit: ExitAnimation | null = null;
  /** true while an exit animation keeps a node React has already removed */
  exiting = false;
  layoutTransition: LayoutTransition | null = null;

  constructor(engine: Engine, type: string, kind: NodeKind, props: Props) {
    this.engine = engine;
    this.type = type;
    this.kind = kind;
    this.props = props;
    if (kind !== 'virtual-text' && kind !== 'raw-text') {
      this.yoga = engine.yoga.Node.create(engine.yogaConfig);
      this.installMeasure();
    }
    this.setProps(props, true);
  }

  // ── style ──────────────────────────────────────────────────────────────

  /** style merged with animated overrides (what painting reads) */
  get computed(): FlatStyle {
    if (!this.computedCache) {
      this.computedCache = this.overrides ? { ...this.style, ...this.overrides } : this.style;
    }
    return this.computedCache;
  }

  setProps(next: Props, initial = false): void {
    const prevStyle = this.style;
    const prevProps = this.props;
    const prevComputed = this.computedCache ?? this.computed;
    this.props = next;
    const style = flattenStyle(next.style);
    this.style = style;
    this.computedCache = null;
    this.engine.onNodeChanged(this);
    if (initial || style !== prevStyle) this.applyStyleChange(initial ? EMPTY : prevComputed, this.computed, initial);
    if (!initial) {
      if (MEASURE_PROPS.some((k) => !Object.is(prevProps[k], next[k]))) {
        if (this.kind === 'text' || this.kind === 'input' || this.kind === 'virtual-text') this.invalidateText();
        else if (this.yoga && this.hasMeasure()) {
          this.yoga.markDirty();
          this.engine.invalidateLayout();
        }
      }
      this.engine.behaviors.propsChanged(this);
    }
  }

  /** Animated / setNativeProps path: bypasses React entirely. */
  setOverrides(values: FlatStyle): void {
    const prev = this.computed;
    const next: FlatStyle = { ...(this.overrides ?? {}) };
    for (const key in values) {
      if (values[key] === undefined) delete next[key];
      else next[key] = values[key];
    }
    this.overrides = Object.keys(next).length ? next : null;
    this.computedCache = null;
    this.applyStyleChange(prev, this.computed);
    this.engine.onNodeChanged(this);
  }

  private applyStyleChange(prev: FlatStyle, next: FlatStyle, force = false): void {
    let layout = force;
    let measure = false;
    for (const key in next) {
      if (!Object.is(prev[key], next[key])) {
        if (LAYOUT_KEYS.has(key)) layout = true;
        if (TEXT_MEASURE_KEYS.has(key)) measure = true;
      }
    }
    for (const key in prev) {
      if (!(key in next)) {
        if (LAYOUT_KEYS.has(key)) layout = true;
        if (TEXT_MEASURE_KEYS.has(key)) measure = true;
      }
    }
    if (layout && this.yoga) {
      const layoutStyle = this.layoutStyle(this.computed);
      applyYogaStyle(this.yoga, this.appliedLayoutStyle, layoutStyle);
      this.appliedLayoutStyle = layoutStyle;
      this.engine.invalidateLayout();
    }
    if (measure) this.invalidateText();
    else if ((this.kind === 'text' || this.kind === 'virtual-text') && prev !== next) {
      // color, decoration, shadow… change the cached runs but not the size
      const root = this.textRoot;
      if (root) root.textLayout = null;
    }
  }

  /** Kind-specific defaults under the user's style, and forced values over it. */
  private layoutStyle(style: FlatStyle): FlatStyle {
    switch (this.kind) {
      case 'scroll':
        return { ...style, overflow: 'scroll' };
      case 'input': {
        const pad = this.engine.kit.text.inputPadding;
        const has = (k: string) => k in style;
        const out: FlatStyle = {};
        if (!has('padding') && !has('paddingVertical') && !has('paddingTop')) out.paddingTop = pad.top;
        if (!has('padding') && !has('paddingVertical') && !has('paddingBottom')) out.paddingBottom = pad.bottom;
        if (!has('padding') && !has('paddingHorizontal') && !has('paddingLeft') && !has('paddingStart')) out.paddingLeft = pad.left;
        if (!has('padding') && !has('paddingHorizontal') && !has('paddingRight') && !has('paddingEnd')) out.paddingRight = pad.right;
        return { ...out, ...style };
      }
      case 'modal':
        return { position: 'absolute', left: 0, top: 0, ...style };
      default:
        return style;
    }
  }

  /** Re-apply kind defaults (e.g. after the platform kit changes). */
  refreshLayoutStyle(): void {
    if (!this.yoga) return;
    const layoutStyle = this.layoutStyle(this.computed);
    applyYogaStyle(this.yoga, this.appliedLayoutStyle, layoutStyle);
    this.appliedLayoutStyle = layoutStyle;
    if (this.hasMeasure()) this.yoga.markDirty();
  }

  // ── text ───────────────────────────────────────────────────────────────

  /** nearest 'text' ancestor-or-self (the node that owns the Yoga measure) */
  get textRoot(): HostNode | null {
    let n: HostNode | null = this;
    while (n && n.kind !== 'text') n = n.parent;
    return n;
  }

  invalidateText(): void {
    const root = this.kind === 'input' ? this : this.textRoot;
    if (!root) return;
    root.textLayout = null;
    if (root.yoga && root.mountedInYoga()) root.yoga.markDirty();
    this.engine.invalidateLayout();
  }

  private mountedInYoga(): boolean {
    return !!this.yoga && (this.yoga.getParent() !== null || this.kind === 'root' || this.kind === 'modal');
  }

  private hasMeasure(): boolean {
    return this.kind === 'text' || this.kind === 'input' || this.kind === 'switch' || this.kind === 'activity' || this.kind === 'image';
  }

  private installMeasure(): void {
    if (!this.yoga || !this.hasMeasure()) return;
    this.yoga.setMeasureFunc((width, widthMode, height, heightMode) => {
      const size = this.engine.measureLeaf(this, widthMode === MeasureMode.Undefined ? Infinity : width);
      const scale = this.engine.viewport.scale;
      const ceil = (v: number) => Math.ceil(v * scale - 0.001) / scale;
      let w = ceil(size.width);
      let h = ceil(size.height);
      if (widthMode === MeasureMode.Exactly) w = width;
      else if (widthMode === MeasureMode.AtMost) w = Math.min(w, width);
      if (heightMode === MeasureMode.Exactly) h = height;
      else if (heightMode === MeasureMode.AtMost) h = Math.min(h, height);
      return { width: w, height: h };
    });
  }

  // ── tree ───────────────────────────────────────────────────────────────

  private yogaIndexOf(child: HostNode): number {
    let index = 0;
    for (const c of this.children) {
      if (c === child) return index;
      if (c.participatesInLayout()) index++;
    }
    return index;
  }

  participatesInLayout(): boolean {
    return !!this.yoga && this.kind !== 'modal';
  }

  appendChild(child: HostNode): void {
    this.insertBefore(child, null);
  }

  insertBefore(child: HostNode, before: HostNode | null): void {
    if (child.parent) child.parent.removeChild(child);
    const at = before ? this.children.indexOf(before) : -1;
    if (at >= 0) this.children.splice(at, 0, child);
    else this.children.push(child);
    child.parent = this;
    if (this.yoga && child.participatesInLayout() && !this.hasMeasure()) {
      this.yoga.insertChild(child.yoga!, this.yogaIndexOf(child));
    }
    if (child.kind === 'raw-text' || child.kind === 'virtual-text') child.invalidateText();
    this.engine.onAttach(child);
    this.engine.invalidateLayout();
  }

  removeChild(child: HostNode): void {
    const at = this.children.indexOf(child);
    if (at < 0) return;
    this.children.splice(at, 1);
    if (this.yoga && child.yoga && child.participatesInLayout() && child.yoga.getParent()) {
      this.yoga.removeChild(child.yoga);
    }
    if (child.kind === 'raw-text' || child.kind === 'virtual-text') this.invalidateText();
    child.parent = null;
    this.engine.onDetach(child);
    this.engine.invalidateLayout();
  }

  setText(text: string): void {
    this.text = text;
    this.invalidateText();
    this.engine.onNodeChanged(this);
  }

  destroy(): void {
    this.engine.onDestroy(this);
    if (this.yoga) {
      this.yoga.unsetMeasureFunc?.();
      this.yoga.free();
      this.yoga = null;
    }
  }

  /** depth-first walk; return false from visit to skip a subtree */
  walk(visit: (node: HostNode) => boolean | void): void {
    if (visit(this) === false) return;
    for (const child of this.children) child.walk(visit);
  }

  // ── React Native imperative API (refs) ─────────────────────────────────

  measure(callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void): void {
    const page = this.engine.geometry.windowRect(this);
    callback(this.x, this.y, this.w, this.h, page.x, page.y);
  }

  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void {
    const r = this.engine.geometry.windowRect(this);
    callback(r.x, r.y, r.w, r.h);
  }

  measureLayout(
    relativeTo: HostNode | number,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ): void {
    const other = typeof relativeTo === 'number' ? this.engine.nodes.get(relativeTo) : relativeTo;
    if (!other) return onFail?.();
    const a = this.engine.geometry.windowRect(this);
    const b = this.engine.geometry.windowRect(other);
    onSuccess(a.x - b.x, a.y - b.y, a.w, a.h);
  }

  getBoundingClientRect() {
    const r = this.engine.geometry.windowRect(this);
    return { x: r.x, y: r.y, width: r.w, height: r.h, top: r.y, left: r.x, right: r.x + r.w, bottom: r.y + r.h };
  }

  setNativeProps(props: Props): void {
    const { style, ...rest } = props;
    if (style) this.setOverrides(flattenStyle(style));
    if (Object.keys(rest).length) this.setProps({ ...this.props, ...rest });
  }

  focus(): void {
    this.engine.focus.focus(this);
  }

  blur(): void {
    this.engine.focus.blur(this);
  }

  isFocused(): boolean {
    return this.engine.focus.focused === this;
  }

  clear(): void {
    this.engine.behaviors.clearText(this);
  }

  scrollTo(options?: { x?: number; y?: number; animated?: boolean } | number, legacyX?: number, animated?: boolean): void {
    const opts = typeof options === 'number' ? { y: options, x: legacyX, animated } : options ?? {};
    this.engine.scrolls.scrollTo(this, opts.x, opts.y, opts.animated !== false);
  }

  scrollToEnd(options?: { animated?: boolean }): void {
    this.engine.scrolls.scrollToEnd(this, options?.animated !== false);
  }

  flashScrollIndicators(): void {
    this.engine.scrolls.flash(this);
  }

  getScrollableNode(): HostNode {
    return this;
  }

  getInnerViewNode(): HostNode | undefined {
    return this.children[0];
  }

  getNativeScrollRef(): HostNode {
    return this;
  }

  /** commands used by Pressable (android_ripple) and controls */
  command(name: string, args: Record<string, unknown> = {}): void {
    this.engine.behaviors.command(this, name, args);
  }

  get nativeID(): string | undefined {
    return this.props.nativeID;
  }

  toString(): string {
    return `${this.type}#${this.id}`;
  }
}
