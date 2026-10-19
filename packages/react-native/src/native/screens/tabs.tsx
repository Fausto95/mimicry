import React, { createContext, forwardRef, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HostNode } from '@mimicry/engine';
import { Platform } from '../../apis/core';
import { Image, Pressable, Text, View } from '../../components/primitives';
import { mergeRefs } from '../../components/pressability';
import { maybeEngine } from '../../engine-ref';
import { useContainerInsets } from './screen';

/**
 * RNSTabsHost{IOS,Android} / RNSTabsScreen{IOS,Android}: the native tab bar
 * controller react-native-screens' `Tabs` (and expo-router's NativeTabs)
 * render — UITabBarController with the iOS 26 floating tab bar, Material 3's
 * NavigationBarView on Android.
 *
 * Selection follows the library's navigation-state protocol: JS requests a
 * selection against a base provenance, the host owns the state and reports
 * every change (user taps included) with a monotonically increasing
 * provenance; a stale request may be rejected.
 */

interface TabItem {
  screenKey: string;
  title?: string | null;
  badgeValue?: string;
  icon?: unknown;
  selectedIcon?: unknown;
  iconTint: 'template' | 'original';
  testID?: string;
  accessibilityLabel?: string;
  preventNativeSelection?: boolean;
  appearance?: any;
  callbacks: Record<string, ((e: { nativeEvent: Record<string, unknown> }) => void) | undefined>;
}

interface TabsApi {
  selectedKey: string | null;
  register(item: TabItem): void;
  unregister(key: string): void;
  /** height the tab bar occupies over the bottom of every tab's screen */
  barInset: number;
}

const TabsContext = createContext<TabsApi | null>(null);

/** Metrics of the bars, measured on the iOS 26 simulator and a Pixel emulator (docs/fidelity.md). */
export const TAB_BAR = {
  ios: { height: 62, sideMargin: 25, bottomMargin: 21, icon: 28, label: 10, itemGap: 2 },
  android: { height: 80, indicatorWidth: 56, indicatorHeight: 32, icon: 24, label: 12 },
};

const dark = () => maybeEngine()?.env.appearance === 'dark';

const sameItem = (a: TabItem | undefined, b: TabItem) =>
  !!a && a.title === b.title && a.badgeValue === b.badgeValue && a.testID === b.testID && a.iconTint === b.iconTint &&
  a.preventNativeSelection === b.preventNativeSelection && JSON.stringify([a.icon, a.selectedIcon, a.appearance]) === JSON.stringify([b.icon, b.selectedIcon, b.appearance]);

export const TabsHost = forwardRef<any, any>(function TabsHost(props, ref) {
  const { children, style, navStateRequest, rejectStaleNavStateUpdates, onTabSelected, onTabSelectionRejected, onTabSelectionPrevented,
    tabBarHidden, nativeContainerBackgroundColor, tabBarTintColor, ...rest } = props;
  const ios = Platform.OS === 'ios';
  const host = useRef<HostNode | null>(null);
  const { insets } = useContainerInsets(host);
  const [items, setItems] = useState<Map<string, TabItem>>(new Map());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const state = useRef<{ selected: string | null; provenance: number; lastUi: number }>({ selected: null, provenance: 0, lastUi: -1 });
  const [, rerender] = useState(0);

  // Order follows the children (each Tabs.Screen element carries its screenKey).
  const order: string[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && typeof (child.props as any).screenKey === 'string') order.push((child.props as any).screenKey);
  });

  // Apply navigation-state requests from JS.
  const requestKey = navStateRequest?.selectedScreenKey as string | undefined;
  const requestBase = navStateRequest?.baseProvenance as number | undefined;
  const lastRequest = useRef<string | null>(null);
  const s = state.current;
  if (s.selected === null && requestKey) {
    s.selected = requestKey;
  }

  const emitLifecycle = (from: string | null, to: string) => {
    const list = itemsRef.current;
    if (from) list.get(from)?.callbacks.onWillDisappear?.({ nativeEvent: {} });
    list.get(to)?.callbacks.onWillAppear?.({ nativeEvent: {} });
    if (from) list.get(from)?.callbacks.onDidDisappear?.({ nativeEvent: {} });
    list.get(to)?.callbacks.onDidAppear?.({ nativeEvent: {} });
  };

  useLayoutEffect(() => {
    const request = `${requestKey}@${requestBase}`;
    if (!requestKey || lastRequest.current === request) return;
    const first = lastRequest.current === null;
    lastRequest.current = request;
    if (first) {
      emitLifecycle(null, s.selected!);
      return;
    }
    if (requestKey === s.selected) return;
    if (rejectStaleNavStateUpdates && requestBase !== undefined && requestBase < s.lastUi) {
      onTabSelectionRejected?.({ nativeEvent: { selectedScreenKey: s.selected, provenance: s.provenance, rejectedScreenKey: requestKey, rejectedBaseProvenance: requestBase, rejectionReason: 'stale' } });
      return;
    }
    const from = s.selected;
    s.selected = requestKey;
    s.provenance++;
    emitLifecycle(from, requestKey);
    onTabSelected?.({ nativeEvent: { selectedScreenKey: requestKey, provenance: s.provenance, isRepeated: false, hasTriggeredSpecialEffect: false, actionOrigin: 'programmatic-js' } });
    rerender((n) => n + 1);
  });

  const select = (key: string) => {
    const item = itemsRef.current.get(key);
    if (key === s.selected) {
      s.provenance++;
      s.lastUi = s.provenance;
      onTabSelected?.({ nativeEvent: { selectedScreenKey: key, provenance: s.provenance, isRepeated: true, hasTriggeredSpecialEffect: false, actionOrigin: 'user' } });
      return;
    }
    if (item?.preventNativeSelection) {
      onTabSelectionPrevented?.({ nativeEvent: { selectedScreenKey: s.selected, provenance: s.provenance, preventedScreenKey: key } });
      return;
    }
    const from = s.selected;
    s.selected = key;
    s.provenance++;
    s.lastUi = s.provenance;
    emitLifecycle(from, key);
    onTabSelected?.({ nativeEvent: { selectedScreenKey: key, provenance: s.provenance, isRepeated: false, hasTriggeredSpecialEffect: false, actionOrigin: 'user' } });
    rerender((n) => n + 1);
  };

  const metrics = ios ? TAB_BAR.ios : TAB_BAR.android;
  const barInset = tabBarHidden ? 0 : ios ? metrics.height + TAB_BAR.ios.bottomMargin - insets.bottom : metrics.height;
  const api = useMemo<TabsApi>(() => ({
    selectedKey: s.selected,
    barInset: Math.max(0, barInset),
    register(item) {
      setItems((prev) => {
        if (sameItem(prev.get(item.screenKey), item)) {
          prev.get(item.screenKey)!.callbacks = item.callbacks;
          return prev;
        }
        const next = new Map(prev);
        next.set(item.screenKey, item);
        return next;
      });
    },
    unregister(key) {
      setItems((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
  }), [s.selected, barInset]);

  const tabs = order.map((k) => items.get(k)).filter((t): t is TabItem => !!t);
  const appearance = items.get(s.selected ?? '')?.appearance ?? tabs[0]?.appearance;
  const bar = tabBarHidden ? null : ios
    ? React.createElement(IOSTabBar, { tabs, selected: s.selected, onSelect: select, tint: tabBarTintColor, appearance, bottom: insets.bottom })
    : React.createElement(AndroidTabBar, { tabs, selected: s.selected, onSelect: select, appearance, bottom: insets.bottom });

  return React.createElement(TabsContext.Provider, { value: api },
    React.createElement(View, {
      ...rest,
      ref: mergeRefs(ref, host),
      style: [{ flex: 1, backgroundColor: nativeContainerBackgroundColor }, style],
    }, children, bar));
});

export const TabsScreen = forwardRef<any, any>(function TabsScreen(props, ref) {
  const tabs = useContext(TabsContext);
  const ios = Platform.OS === 'ios';
  const { children, style, screenKey } = props;
  useLayoutEffect(() => {
    tabs?.register({
      screenKey,
      title: props.title,
      badgeValue: props.badgeValue,
      icon: ios ? props.iconImageSource ?? (props.iconResourceName ? { sfSymbol: props.iconResourceName } : undefined) : props.imageIconResource,
      selectedIcon: ios ? props.selectedIconImageSource : props.selectedImageIconResource,
      iconTint: (ios ? props.iconImageRenderingMode : props.iconTinting) === 'original' ? 'original' : 'template',
      testID: props.tabBarItemTestID,
      accessibilityLabel: props.tabBarItemAccessibilityLabel,
      preventNativeSelection: props.preventNativeSelection,
      appearance: props.standardAppearance,
      callbacks: { onWillAppear: props.onWillAppear, onDidAppear: props.onDidAppear, onWillDisappear: props.onWillDisappear, onDidDisappear: props.onDidDisappear },
    });
  });
  useLayoutEffect(() => () => tabs?.unregister(screenKey), [tabs, screenKey]);
  const selected = tabs?.selectedKey === screenKey;
  return React.createElement(View, {
    ref,
    pointerEvents: selected ? 'box-none' : 'none',
    // UITabBarController / NavigationBarView: the bar is part of every tab's bottom safe area
    additionalSafeAreaInsets: tabs && ios ? { bottom: tabs.barInset } : undefined,
    style: [style, { position: 'absolute', left: 0, top: 0, right: 0, bottom: ios ? 0 : tabs?.barInset ?? 0 }, selected ? null : { display: 'none' }],
    children,
  });
});

// ── bars ─────────────────────────────────────────────────────────────────

function color(value: unknown, fallback: string): unknown {
  if (value == null) return fallback;
  if (typeof value === 'number') {
    const v = value >>> 0;
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${((v >>> 24) & 255) / 255})`;
  }
  return value;
}

function TabIcon({ item, selected, size, tint }: { item: TabItem; selected: boolean; size: number; tint: unknown }) {
  const source = (selected && item.selectedIcon) || item.icon;
  if (!source || (source as any).sfSymbol) return React.createElement(View, { style: { width: size, height: size } });
  return React.createElement(Image, {
    source,
    style: { width: size, height: size, tintColor: item.iconTint === 'template' ? (tint as any) : undefined },
    resizeMode: 'contain',
  });
}

function IOSTabBar({ tabs, selected, onSelect, tint, appearance, bottom }: { tabs: TabItem[]; selected: string | null; onSelect(k: string): void; tint: unknown; appearance: any; bottom: number }) {
  const m = TAB_BAR.ios;
  const isDark = dark();
  const state = (k: 'normal' | 'selected') => appearance?.stacked?.[k] ?? {};
  const active = color(tint ?? state('selected').tabBarItemTitleFontColor, isDark ? '#0a84ff' : '#007aff');
  const inactive = color(state('normal').tabBarItemTitleFontColor, isDark ? '#ffffff' : '#000000');
  void bottom;
  return React.createElement(View, {
    testID: 'tab-bar',
    accessibilityRole: 'tablist',
    backdrop: { blur: 12, saturation: 1.8 },
    style: {
      position: 'absolute', left: m.sideMargin, right: m.sideMargin, bottom: m.bottomMargin, height: m.height, borderRadius: m.height / 2,
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4,
      backgroundColor: color(appearance?.tabBarBackgroundColor, isDark ? 'rgba(30,30,32,0.72)' : 'rgba(255,255,255,0.72)'),
      borderWidth: 0.5, borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    },
  }, tabs.map((t) => {
    const on = t.screenKey === selected;
    const c = on ? active : inactive;
    return React.createElement(Pressable, {
      key: t.screenKey,
      testID: t.testID,
      accessibilityRole: 'tab',
      accessibilityLabel: t.accessibilityLabel ?? t.title ?? undefined,
      accessibilityState: { selected: on },
      onPress: () => onSelect(t.screenKey),
      style: {
        flex: 1, height: m.height - 8, borderRadius: (m.height - 8) / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)') : undefined,
      },
    },
      React.createElement(TabIcon, { item: t, selected: on, size: m.icon, tint: c }),
      t.title ? React.createElement(Text, { numberOfLines: 1, style: { fontSize: m.label, fontWeight: '600', color: c, marginTop: m.itemGap } }, t.title) : null,
      t.badgeValue ? React.createElement(Badge, { value: t.badgeValue }) : null);
  }));
}

function AndroidTabBar({ tabs, selected, onSelect, appearance, bottom }: { tabs: TabItem[]; selected: string | null; onSelect(k: string): void; appearance: any; bottom: number }) {
  const m = TAB_BAR.android;
  const isDark = dark();
  const background = color(appearance?.tabBarBackgroundColor, isDark ? '#211f26' : '#f3edf7');
  const indicator = color(appearance?.tabBarItemActiveIndicatorColor, isDark ? '#4a4458' : '#e8def8');
  const activeColor = color(appearance?.tabBarItemIconColorActive ?? appearance?.tabBarItemTitleFontColorActive, isDark ? '#e8def8' : '#1d192b');
  const inactiveColor = color(appearance?.tabBarItemIconColor ?? appearance?.tabBarItemTitleFontColor, isDark ? '#cac4d0' : '#49454f');
  return React.createElement(View, {
    testID: 'tab-bar',
    accessibilityRole: 'tablist',
    style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: m.height + bottom, paddingBottom: bottom, flexDirection: 'row', backgroundColor: background },
  }, tabs.map((t) => {
    const on = t.screenKey === selected;
    const c = on ? activeColor : inactiveColor;
    return React.createElement(Pressable, {
      key: t.screenKey,
      testID: t.testID,
      accessibilityRole: 'tab',
      accessibilityLabel: t.accessibilityLabel ?? t.title ?? undefined,
      accessibilityState: { selected: on },
      onPress: () => onSelect(t.screenKey),
      style: { flex: 1, alignItems: 'center', paddingTop: 12 },
    },
      React.createElement(View, {
        style: { width: m.indicatorWidth, height: m.indicatorHeight, borderRadius: m.indicatorHeight / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? indicator : undefined },
      }, React.createElement(TabIcon, { item: t, selected: on, size: m.icon, tint: c })),
      t.title ? React.createElement(Text, { numberOfLines: 1, style: { fontSize: m.label, fontWeight: on ? '700' : '500', color: c, marginTop: 4, letterSpacing: 0.5 } }, t.title) : null,
      t.badgeValue ? React.createElement(Badge, { value: t.badgeValue }) : null);
  }));
}

function Badge({ value }: { value: string }) {
  return React.createElement(View, {
    pointerEvents: 'none',
    style: { position: 'absolute', top: 4, left: '55%', minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: '#ff3b30', alignItems: 'center', justifyContent: 'center' },
  }, React.createElement(Text, { style: { color: 'white', fontSize: 12, fontWeight: '600' } }, value));
}

/** RNSTabsBottomAccessory: the iOS 26 accessory above the tab bar (rendered in place). */
export const TabsBottomAccessory = forwardRef<any, any>(function TabsBottomAccessory(props, ref) {
  return React.createElement(View, { ref, style: [props.style, { position: 'absolute', left: 25, right: 25, bottom: TAB_BAR.ios.bottomMargin + TAB_BAR.ios.height + 8 }], children: props.children });
});

export const TabsBottomAccessoryContent = forwardRef<any, any>(function TabsBottomAccessoryContent(props, ref) {
  return props.environment === 'inline' ? null : React.createElement(View, { ref, style: props.style, children: props.children });
});

