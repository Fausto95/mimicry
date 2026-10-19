export type FlatStyle = Record<string, any>;
export type StyleProp = FlatStyle | null | undefined | false | readonly StyleProp[];

const EMPTY: FlatStyle = Object.freeze({}) as FlatStyle;

/** StyleSheet.flatten semantics: later entries win, falsy entries are skipped. */
export function flattenStyle(style: unknown): FlatStyle {
  if (!style) return EMPTY;
  if (!Array.isArray(style)) return style as FlatStyle;
  const out: FlatStyle = {};
  merge(out, style);
  return out;
}

function merge(out: FlatStyle, style: unknown): void {
  if (!style) return;
  if (Array.isArray(style)) {
    for (const item of style) merge(out, item);
    return;
  }
  if (typeof style === 'object') Object.assign(out, style);
}

export function shallowEqual(a: FlatStyle, b: FlatStyle): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    if (!Object.is(a[k], b[k]) && !deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

/** Keys whose change requires a new Yoga layout. */
export const LAYOUT_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'flexDirection', 'flexWrap',
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent',
  'position', 'top', 'right', 'bottom', 'left', 'start', 'end',
  'inset', 'insetBlock', 'insetBlockStart', 'insetBlockEnd', 'insetInline', 'insetInlineStart', 'insetInlineEnd',
  'margin', 'marginHorizontal', 'marginVertical', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'marginStart', 'marginEnd', 'marginBlock', 'marginBlockStart', 'marginBlockEnd', 'marginInline', 'marginInlineStart', 'marginInlineEnd',
  'padding', 'paddingHorizontal', 'paddingVertical', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'paddingStart', 'paddingEnd', 'paddingBlock', 'paddingBlockStart', 'paddingBlockEnd', 'paddingInline', 'paddingInlineStart', 'paddingInlineEnd',
  'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStartWidth', 'borderEndWidth',
  'gap', 'rowGap', 'columnGap', 'aspectRatio', 'display', 'overflow', 'direction', 'boxSizing',
]);

/** Keys that change how text measures (they dirty the measure function). */
export const TEXT_MEASURE_KEYS = new Set([
  'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'letterSpacing', 'lineHeight',
  'textTransform', 'fontVariant', 'includeFontPadding',
]);
