import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { HostType } from '@mimicry/engine';
import { View } from './primitives';

const h = React.createElement as (...args: any[]) => React.ReactElement;
type AnyProps = Record<string, any>;

/**
 * ScrollView: the host node owns scrolling (physics, indicators, events);
 * this component reproduces React Native's JS structure — a scroll host with
 * one content container — so layout matches what Fabric produces.
 */
const baseVertical = { flexGrow: 1, flexShrink: 1, flexDirection: 'column', overflow: 'scroll' };
const baseHorizontal = { flexGrow: 1, flexShrink: 1, flexDirection: 'row', overflow: 'scroll' };

export const ScrollView = forwardRef<any, AnyProps>(function ScrollView(props, ref) {
  const { children, contentContainerStyle, horizontal, style, onContentSizeChange, refreshControl, stickyHeaderIndices, invertStickyHeaders, ...rest } = props;
  const onLayout = onContentSizeChange
    ? (e: any) => onContentSizeChange(e.nativeEvent.layout.width, e.nativeEvent.layout.height)
    : undefined;
  return h(
    HostType.ScrollView,
    { ...rest, horizontal: !!horizontal, style: [horizontal ? baseHorizontal : baseVertical, style], ref },
    h(View, { collapsable: false, onLayout, style: [horizontal ? { flexDirection: 'row' } : null, contentContainerStyle] }, children),
  );
});

// ── FlatList / SectionList ─────────────────────────────────────────────────

function renderComponent(c: unknown): React.ReactNode {
  if (!c) return null;
  if (React.isValidElement(c)) return c;
  return h(c as React.ComponentType);
}

function defaultKey(item: any, index: number): string {
  if (item && typeof item === 'object') {
    if (item.key != null) return String(item.key);
    if (item.id != null) return String(item.id);
  }
  return String(index);
}

interface ListHandle {
  scrollToIndex(params: { index: number; animated?: boolean; viewOffset?: number; viewPosition?: number }): void;
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
  scrollToEnd(params?: { animated?: boolean }): void;
  scrollToItem(params: { item: unknown; animated?: boolean; viewPosition?: number }): void;
  flashScrollIndicators(): void;
  getScrollResponder(): unknown;
  getNativeScrollRef(): unknown;
  getScrollableNode(): unknown;
  recordInteraction(): void;
}

/**
 * Not virtualized: every item renders. The painter culls and tiles what is
 * off screen, so drawing stays proportional to the viewport, but React work
 * grows with the data set (docs/fidelity.md).
 */
export const FlatList = forwardRef<ListHandle, AnyProps>(function FlatList(props, ref) {
  const {
    data, renderItem, keyExtractor = defaultKey, ItemSeparatorComponent, ListHeaderComponent, ListFooterComponent,
    ListEmptyComponent, ListHeaderComponentStyle, ListFooterComponentStyle, numColumns = 1, columnWrapperStyle,
    horizontal, inverted, onEndReached, onEndReachedThreshold = 2, onScroll, getItemLayout, extraData,
    initialNumToRender, maxToRenderPerBatch, windowSize, removeClippedSubviews, CellRendererComponent, onViewableItemsChanged,
    viewabilityConfig, ...rest
  } = props;
  const scroll = useRef<any>(null);
  const offsets = useRef<Map<number, { offset: number; length: number }>>(new Map());
  const reachedEnd = useRef(false);
  const items: any[] = data ?? [];

  useImperativeHandle(ref, () => ({
    scrollToIndex({ index, animated = true, viewOffset = 0, viewPosition = 0 }) {
      const node = scroll.current;
      if (!node) return;
      const known = getItemLayout ? getItemLayout(items, index) : offsets.current.get(index);
      if (!known) return;
      const viewport = horizontal ? node.w : node.h;
      const target = known.offset - viewOffset - (viewport - known.length) * viewPosition;
      node.scrollTo(horizontal ? { x: target, animated } : { y: target, animated });
    },
    scrollToOffset({ offset, animated = true }) {
      scroll.current?.scrollTo(horizontal ? { x: offset, animated } : { y: offset, animated });
    },
    scrollToEnd(params) {
      scroll.current?.scrollToEnd(params);
    },
    scrollToItem({ item, animated, viewPosition }) {
      const index = items.indexOf(item);
      if (index >= 0) (this as ListHandle).scrollToIndex({ index, animated, viewPosition });
    },
    flashScrollIndicators() {
      scroll.current?.flashScrollIndicators();
    },
    getScrollResponder: () => scroll.current,
    getNativeScrollRef: () => scroll.current,
    getScrollableNode: () => scroll.current,
    recordInteraction() {},
  }), [items, horizontal, getItemLayout]);

  const handleScroll = useCallback((e: any) => {
    onScroll?.(e);
    if (!onEndReached) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const visibleEnd = horizontal ? contentOffset.x + layoutMeasurement.width : contentOffset.y + layoutMeasurement.height;
    const length = horizontal ? contentSize.width : contentSize.height;
    const viewport = horizontal ? layoutMeasurement.width : layoutMeasurement.height;
    const near = length - visibleEnd <= onEndReachedThreshold * viewport;
    if (near && !reachedEnd.current) {
      reachedEnd.current = true;
      onEndReached({ distanceFromEnd: length - visibleEnd });
    } else if (!near) reachedEnd.current = false;
  }, [onScroll, onEndReached, onEndReachedThreshold, horizontal]);

  const invert = inverted ? (horizontal ? { transform: [{ scaleX: -1 }] } : { transform: [{ scaleY: -1 }] }) : null;
  const cell = (item: any, index: number) => {
    const key = keyExtractor(item, index);
    const separators = { highlight() {}, unhighlight() {}, updateProps() {} };
    const element = renderItem?.({ item, index, separators });
    const record = (e: any) => {
      const l = e.nativeEvent.layout;
      offsets.current.set(index, horizontal ? { offset: l.x, length: l.width } : { offset: l.y, length: l.height });
    };
    const Cell = CellRendererComponent ?? View;
    return h(
      React.Fragment,
      { key },
      h(Cell, { onLayout: record, style: invert, index, item }, element),
      ItemSeparatorComponent && index < items.length - 1 ? h(ItemSeparatorComponent, { highlighted: false, leadingItem: item }) : null,
    );
  };

  let body: React.ReactNode;
  if (!items.length) {
    body = renderComponent(ListEmptyComponent);
  } else if (numColumns > 1) {
    const rows: React.ReactNode[] = [];
    for (let r = 0; r * numColumns < items.length; r++) {
      const rowItems = items.slice(r * numColumns, r * numColumns + numColumns);
      rows.push(h(
        View,
        { key: `row-${r}`, style: [{ flexDirection: 'row' }, columnWrapperStyle, invert] },
        rowItems.map((item, i) => {
          const index = r * numColumns + i;
          return h(View, { key: keyExtractor(item, index), style: { flex: 1 } }, renderItem?.({ item, index, separators: {} }));
        }),
      ));
      if (ItemSeparatorComponent && (r + 1) * numColumns < items.length) rows.push(h(ItemSeparatorComponent, { key: `sep-${r}` }));
    }
    body = rows;
  } else {
    body = items.map(cell);
  }

  return h(
    ScrollView,
    {
      ...rest,
      horizontal,
      ref: scroll,
      onScroll: handleScroll,
      style: [rest.style, invert],
    },
    ListHeaderComponent ? h(View, { style: [ListHeaderComponentStyle, invert] }, renderComponent(ListHeaderComponent)) : null,
    body,
    ListFooterComponent ? h(View, { style: [ListFooterComponentStyle, invert] }, renderComponent(ListFooterComponent)) : null,
  );
});

export const SectionList = forwardRef<any, AnyProps>(function SectionList(props, ref) {
  const {
    sections = [], renderItem, renderSectionHeader, renderSectionFooter, keyExtractor = defaultKey,
    ItemSeparatorComponent, SectionSeparatorComponent, ListHeaderComponent, ListFooterComponent, ListEmptyComponent,
    stickySectionHeadersEnabled, ...rest
  } = props;
  const scroll = useRef<any>(null);
  useImperativeHandle(ref, () => ({
    scrollToLocation() {},
    getScrollResponder: () => scroll.current,
    getScrollableNode: () => scroll.current,
    flashScrollIndicators: () => scroll.current?.flashScrollIndicators(),
    recordInteraction() {},
  }));
  const children: React.ReactNode[] = [];
  sections.forEach((section: any, s: number) => {
    const sectionKey = section.key ?? String(s);
    if (renderSectionHeader) children.push(h(View, { key: `h-${sectionKey}` }, renderSectionHeader({ section })));
    if (SectionSeparatorComponent) children.push(h(SectionSeparatorComponent, { key: `ss-${sectionKey}` }));
    (section.data ?? []).forEach((item: any, index: number) => {
      const render = section.renderItem ?? renderItem;
      children.push(h(View, { key: `${sectionKey}-${keyExtractor(item, index)}` }, render?.({ item, index, section, separators: {} })));
      if (ItemSeparatorComponent && index < section.data.length - 1) children.push(h(ItemSeparatorComponent, { key: `sep-${sectionKey}-${index}` }));
    });
    if (renderSectionFooter) children.push(h(View, { key: `f-${sectionKey}` }, renderSectionFooter({ section })));
  });
  return h(
    ScrollView,
    { ...rest, ref: scroll },
    renderComponent(ListHeaderComponent),
    sections.length ? children : renderComponent(ListEmptyComponent),
    renderComponent(ListFooterComponent),
  );
});

export const VirtualizedList = forwardRef<any, AnyProps>(function VirtualizedList(props, ref) {
  const { getItem, getItemCount, data, ...rest } = props;
  const count = getItemCount ? getItemCount(data) : 0;
  const items = Array.from({ length: count }, (_, i) => (getItem ? getItem(data, i) : undefined));
  return h(FlatList, { ...rest, data: items, ref });
});
