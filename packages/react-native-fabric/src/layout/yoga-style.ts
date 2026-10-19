import type { Node as YogaNode } from 'yoga-layout/load';
import {
  Align, BoxSizing, Direction, Display, Edge, FlexDirection, Gutter, Justify, Overflow, PositionType, Wrap,
} from 'yoga-layout/load';
import type { FlatStyle } from '../style/flatten';

/**
 * Applies React Native layout style to a Yoga node. Only changed keys are
 * touched so unrelated subtrees keep their cached layout.
 */
type Setter = (node: YogaNode, value: any) => void;

type Dim = number | 'auto' | `${number}%` | undefined;

function dim(value: unknown): Dim {
  if (value == null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const s = String(value).trim();
  if (s === 'auto') return 'auto';
  if (s.endsWith('%')) return `${parseFloat(s)}%` as `${number}%`;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

const noAuto = (v: unknown) => {
  const d = dim(v);
  return d === 'auto' ? undefined : d;
};

const enumOf = <T>(table: Record<string, T>, fallback: T) => (value: unknown): T =>
  value == null ? fallback : (table[String(value)] ?? fallback);

const flexDirection = enumOf<FlexDirection>({
  row: FlexDirection.Row, column: FlexDirection.Column,
  'row-reverse': FlexDirection.RowReverse, 'column-reverse': FlexDirection.ColumnReverse,
}, FlexDirection.Column);

const justify = enumOf<Justify>({
  'flex-start': Justify.FlexStart, center: Justify.Center, 'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween, 'space-around': Justify.SpaceAround, 'space-evenly': Justify.SpaceEvenly,
  start: Justify.FlexStart, end: Justify.FlexEnd,
}, Justify.FlexStart);

const alignTable: Record<string, Align> = {
  auto: Align.Auto, 'flex-start': Align.FlexStart, center: Align.Center, 'flex-end': Align.FlexEnd,
  stretch: Align.Stretch, baseline: Align.Baseline, 'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround, 'space-evenly': Align.SpaceEvenly, start: Align.FlexStart, end: Align.FlexEnd,
};

const wrap = enumOf<Wrap>({ wrap: Wrap.Wrap, nowrap: Wrap.NoWrap, 'wrap-reverse': Wrap.WrapReverse }, Wrap.NoWrap);
const position = enumOf<PositionType>(
  { absolute: PositionType.Absolute, relative: PositionType.Relative, static: PositionType.Static },
  PositionType.Relative,
);
const display = enumOf<Display>({ none: Display.None, flex: Display.Flex, contents: Display.Contents }, Display.Flex);
const overflow = enumOf<Overflow>({ visible: Overflow.Visible, hidden: Overflow.Hidden, scroll: Overflow.Scroll }, Overflow.Visible);
const direction = enumOf<Direction>({ ltr: Direction.LTR, rtl: Direction.RTL, inherit: Direction.Inherit }, Direction.Inherit);

const edges = (prefix: string, set: (n: YogaNode, e: Edge, v: any) => void, value: (v: unknown) => any) => {
  const map: Record<string, Edge> = {
    [prefix]: Edge.All,
    [prefix + 'Horizontal']: Edge.Horizontal,
    [prefix + 'Vertical']: Edge.Vertical,
    [prefix + 'Top']: Edge.Top,
    [prefix + 'Right']: Edge.Right,
    [prefix + 'Bottom']: Edge.Bottom,
    [prefix + 'Left']: Edge.Left,
    [prefix + 'Start']: Edge.Start,
    [prefix + 'End']: Edge.End,
    [prefix + 'Block']: Edge.Vertical,
    [prefix + 'BlockStart']: Edge.Top,
    [prefix + 'BlockEnd']: Edge.Bottom,
    [prefix + 'Inline']: Edge.Horizontal,
    [prefix + 'InlineStart']: Edge.Start,
    [prefix + 'InlineEnd']: Edge.End,
  };
  const out: Record<string, Setter> = {};
  for (const [key, edge] of Object.entries(map)) out[key] = (n, v) => set(n, edge, value(v));
  return out;
};

const setters: Record<string, Setter> = {
  width: (n, v) => n.setWidth(dim(v)),
  height: (n, v) => n.setHeight(dim(v)),
  minWidth: (n, v) => n.setMinWidth(noAuto(v)),
  maxWidth: (n, v) => n.setMaxWidth(noAuto(v)),
  minHeight: (n, v) => n.setMinHeight(noAuto(v)),
  maxHeight: (n, v) => n.setMaxHeight(noAuto(v)),
  flex: (n, v) => n.setFlex(v == null ? undefined : Number(v)),
  flexGrow: (n, v) => n.setFlexGrow(v == null ? undefined : Number(v)),
  flexShrink: (n, v) => n.setFlexShrink(v == null ? undefined : Number(v)),
  flexBasis: (n, v) => n.setFlexBasis(dim(v)),
  flexDirection: (n, v) => n.setFlexDirection(flexDirection(v)),
  flexWrap: (n, v) => n.setFlexWrap(wrap(v)),
  justifyContent: (n, v) => n.setJustifyContent(justify(v)),
  alignItems: (n, v) => n.setAlignItems(v == null ? Align.Stretch : (alignTable[v] ?? Align.Stretch)),
  alignSelf: (n, v) => n.setAlignSelf(v == null ? Align.Auto : (alignTable[v] ?? Align.Auto)),
  // React Native's default alignContent is flex-start (Yoga's non-web default)
  alignContent: (n, v) => n.setAlignContent(v == null ? Align.FlexStart : (alignTable[v] ?? Align.FlexStart)),
  position: (n, v) => n.setPositionType(position(v)),
  top: (n, v) => n.setPosition(Edge.Top, noAuto(v)),
  right: (n, v) => n.setPosition(Edge.Right, noAuto(v)),
  bottom: (n, v) => n.setPosition(Edge.Bottom, noAuto(v)),
  left: (n, v) => n.setPosition(Edge.Left, noAuto(v)),
  start: (n, v) => n.setPosition(Edge.Start, noAuto(v)),
  end: (n, v) => n.setPosition(Edge.End, noAuto(v)),
  inset: (n, v) => n.setPosition(Edge.All, noAuto(v)),
  insetBlock: (n, v) => n.setPosition(Edge.Vertical, noAuto(v)),
  insetBlockStart: (n, v) => n.setPosition(Edge.Top, noAuto(v)),
  insetBlockEnd: (n, v) => n.setPosition(Edge.Bottom, noAuto(v)),
  insetInline: (n, v) => n.setPosition(Edge.Horizontal, noAuto(v)),
  insetInlineStart: (n, v) => n.setPosition(Edge.Start, noAuto(v)),
  insetInlineEnd: (n, v) => n.setPosition(Edge.End, noAuto(v)),
  ...edges('margin', (n, e, v) => n.setMargin(e, v), dim),
  ...edges('padding', (n, e, v) => n.setPadding(e, v), noAuto),
  borderWidth: (n, v) => n.setBorder(Edge.All, num(v)),
  borderTopWidth: (n, v) => n.setBorder(Edge.Top, num(v)),
  borderRightWidth: (n, v) => n.setBorder(Edge.Right, num(v)),
  borderBottomWidth: (n, v) => n.setBorder(Edge.Bottom, num(v)),
  borderLeftWidth: (n, v) => n.setBorder(Edge.Left, num(v)),
  borderStartWidth: (n, v) => n.setBorder(Edge.Start, num(v)),
  borderEndWidth: (n, v) => n.setBorder(Edge.End, num(v)),
  gap: (n, v) => n.setGap(Gutter.All, noAuto(v)),
  rowGap: (n, v) => n.setGap(Gutter.Row, noAuto(v)),
  columnGap: (n, v) => n.setGap(Gutter.Column, noAuto(v)),
  aspectRatio: (n, v) => n.setAspectRatio(aspect(v)),
  display: (n, v) => n.setDisplay(display(v)),
  overflow: (n, v) => n.setOverflow(overflow(v)),
  direction: (n, v) => n.setDirection(direction(v)),
  boxSizing: (n, v) => n.setBoxSizing(v === 'content-box' ? BoxSizing.ContentBox : BoxSizing.BorderBox),
};

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function aspect(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes('/')) {
    const [a, b] = s.split('/').map((p) => parseFloat(p));
    return a && b ? a / b : undefined;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Apply `next` given the previously applied `prev`. Keys present in prev and
 * absent from next are reset to Yoga's React Native defaults.
 */
export function applyYogaStyle(node: YogaNode, prev: FlatStyle | null, next: FlatStyle): boolean {
  let changed = false;
  if (prev) {
    for (const key in prev) {
      if (!(key in next) && setters[key]) {
        setters[key]!(node, undefined);
        changed = true;
      }
    }
  }
  for (const key in next) {
    const setter = setters[key];
    if (!setter) continue;
    const value = next[key];
    if (prev && Object.is(prev[key], value)) continue;
    setter(node, value);
    changed = true;
  }
  return changed;
}

export const isLayoutKey = (key: string) => key in setters;
