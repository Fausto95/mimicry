import React, { createContext, forwardRef, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HostNode } from '@mimicry/react-native-fabric';
import { Animated } from '../../animated';
import { AnimatedValue } from '../../animated/animated';
import { Platform } from '../../apis/core';
import { Pressable, Text, View } from '../../components/primitives';
import { maybeEngine } from '../../engine-ref';
import { Glyph } from './glyphs';
import { ScreenContext } from './screen';
import { StackContext, StackItemContext } from './stack';

/**
 * RNSScreenStackHeaderConfig: the navigation bar of a stack screen
 * (UINavigationBar on iOS, the Material toolbar on Android) and
 * RNSScreenStackHeaderSubview, the custom views placed in it.
 *
 * The bar is drawn by the screen it configures, over the screen's top edge,
 * and reports its height so the screen's content safe area starts below it
 * (unless the bar is translucent, in which case content runs under it and
 * inset-adjusting scroll views use the safe area to stay clear).
 */

/** Platform metrics of the bar, from the iOS 26 / Material 3 simulators (docs/fidelity.md). */
export const BAR = {
  ios: { height: 44, largeTitleHeight: 52, sideInset: 16, titleSize: 17, largeTitleSize: 34, backButton: 44 },
  android: { height: 64, sideInset: 16, titleSize: 22, iconSize: 24, titleInsetWithIcon: 72 },
};

interface HeaderSlots {
  register(type: string): () => void;
  tint: unknown;
}
const HeaderSlotsContext = createContext<HeaderSlots | null>(null);

const dark = () => maybeEngine()?.env.appearance === 'dark';
const label = () => (dark() ? '#ffffff' : '#000000');

export const HeaderConfig = forwardRef<any, any>(function HeaderConfig(props, ref) {
  const screen = useContext(ScreenContext);
  const item = useContext(StackItemContext);
  const stack = useContext(StackContext);
  const [slots, setSlots] = useState<Record<string, number>>({});
  const ios = Platform.OS === 'ios';
  const hidden = !!props.hidden;
  const large = ios && !!props.largeTitle;
  const translucent = !!props.translucent;
  const m = ios ? BAR.ios : BAR.android;
  const barHeight = hidden ? 0 : m.height + (large ? BAR.ios.largeTitleHeight : 0);

  // Content goes below an opaque bar; a translucent bar only adds to the safe area.
  useLayoutEffect(() => {
    screen?.setTopBar(barHeight, !ios && !translucent);
    return () => screen?.setTopBar(0, false);
  }, [screen, barHeight, translucent, ios]);

  const api = useMemo<HeaderSlots>(() => ({
    register(type) {
      setSlots((s) => ({ ...s, [type]: (s[type] ?? 0) + 1 }));
      return () => setSlots((s) => ({ ...s, [type]: Math.max(0, (s[type] ?? 1) - 1) }));
    },
    tint: props.color,
  }), [props.color]);

  const collapse = useLargeTitleCollapse(large && !hidden ? screen?.host : undefined);

  if (hidden || !screen) return null;
  const top = screen.baseInsets.top;
  const index = item?.index ?? 0;
  const canGoBack = index > 0 && !props.hideBackButton && (!slots.left || props.backButtonInCustomView);
  const hasCenter = !!slots.center;
  const tint = props.color ?? (ios ? label() : label());
  const titleColor = props.titleColor ?? label();
  const background = props.backgroundColor ?? (ios ? 'transparent' : dark() ? '#121212' : '#ffffff');
  const goBack = () => item && stack?.dismiss(item.key, 'button');
  const title = props.title ?? '';

  if (ios) {
    const backButton = canGoBack && !slots.back
      ? React.createElement(Pressable, {
          key: 'back',
          testID: 'header-back',
          accessibilityRole: 'button',
          accessibilityLabel: props.backTitle || 'Back',
          onPress: goBack,
          style: ({ pressed }: { pressed: boolean }) => ({
            position: 'absolute', left: BAR.ios.sideInset, top: 0, width: BAR.ios.backButton, height: BAR.ios.backButton,
            borderRadius: BAR.ios.backButton / 2, alignItems: 'center', justifyContent: 'center',
            backgroundColor: dark() ? 'rgba(120,120,128,0.32)' : 'rgba(255,255,255,0.86)',
            borderWidth: 0.5, borderColor: dark() ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
            shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
            opacity: pressed ? 0.6 : 1,
          }),
        }, React.createElement(Glyph, { name: 'chevronBackward', size: { width: 11, height: 19 }, color: tint, style: { marginLeft: -2 } }))
      : null;
    return React.createElement(HeaderSlotsContext.Provider, { value: api },
      React.createElement(View, {
        ref,
        pointerEvents: 'box-none',
        testID: 'navigation-bar',
        style: { position: 'absolute', left: 0, right: 0, top: 0, paddingTop: top, backgroundColor: background, zIndex: 10 },
      },
        React.createElement(View, { pointerEvents: 'box-none', style: { height: BAR.ios.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' } },
          !hasCenter && title
            ? React.createElement(Animated.Text as any, {
                numberOfLines: 1,
                style: {
                  fontSize: props.titleFontSize ?? BAR.ios.titleSize, fontWeight: props.titleFontWeight ?? '600', fontFamily: props.titleFontFamily, color: titleColor, maxWidth: '60%',
                  // with a large title, the inline title appears once the large one has scrolled away
                  opacity: large ? collapse.interpolate({ inputRange: [0.85, 1], outputRange: [0, 1], extrapolate: 'clamp' }) : 1,
                },
              }, title)
            : null,
          backButton,
          props.children),
        large
          ? React.createElement(Animated.View as any, {
              pointerEvents: 'none',
              style: {
                // the large title scrolls up under the bar with the content
                height: collapse.interpolate({ inputRange: [0, 1], outputRange: [BAR.ios.largeTitleHeight, 0], extrapolate: 'clamp' }),
                overflow: 'hidden', paddingHorizontal: BAR.ios.sideInset, justifyContent: 'flex-end', paddingBottom: 8, backgroundColor: props.largeTitleBackgroundColor,
              },
            },
              React.createElement(Text, {
                numberOfLines: 1,
                style: { fontSize: props.largeTitleFontSize ?? BAR.ios.largeTitleSize, fontWeight: props.largeTitleFontWeight ?? '700', fontFamily: props.largeTitleFontFamily, color: props.largeTitleColor ?? titleColor },
              }, title))
          : null));
  }

  // Android: Material top app bar (react-native-screens' toolbar)
  const showBack = canGoBack && !slots.back;
  return React.createElement(HeaderSlotsContext.Provider, { value: api },
    React.createElement(View, {
      ref,
      pointerEvents: 'box-none',
      testID: 'navigation-bar',
      style: {
        position: 'absolute', left: 0, right: 0, top: 0, paddingTop: props.topInsetEnabled === false ? 0 : top, backgroundColor: background, zIndex: 10,
        ...(props.hideShadow || translucent ? null : { elevation: 4, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }),
      },
    },
      React.createElement(View, { pointerEvents: 'box-none', style: { height: BAR.android.height, flexDirection: 'row', alignItems: 'center' } },
        showBack
          ? React.createElement(Pressable, {
              testID: 'header-back',
              accessibilityRole: 'button',
              accessibilityLabel: 'Navigate up',
              onPress: goBack,
              android_ripple: { borderless: true, radius: 20 },
              style: { width: 48, height: 48, marginLeft: 4, alignItems: 'center', justifyContent: 'center' },
            }, React.createElement(Glyph, { name: 'arrowBack', size: { width: 24, height: 24 }, color: tint }))
          : null,
        !hasCenter && title
          ? React.createElement(Text, {
              numberOfLines: 1,
              style: {
                flex: 1, marginLeft: showBack ? BAR.android.titleInsetWithIcon - 52 : BAR.android.sideInset, fontSize: props.titleFontSize ?? BAR.android.titleSize,
                fontWeight: props.titleFontWeight ?? '400', fontFamily: props.titleFontFamily, color: titleColor,
              },
            }, title)
          : React.createElement(View, { style: { flex: 1 } }),
        props.children)));
});

/**
 * How far a large title has collapsed (0 = expanded, 1 = inline): follows the
 * first vertical scroll view in the screen, like UINavigationController
 * tracking its view controller's content scroll view.
 */
function useLargeTitleCollapse(host: React.RefObject<HostNode | null> | undefined): AnimatedValue {
  const value = useRef(new AnimatedValue(0)).current;
  useEffect(() => {
    const engine = maybeEngine();
    if (!host || !engine) return;
    let tracked: HostNode | null = null;
    const isTracked = (node: HostNode) => {
      if (tracked) return node === tracked;
      if (node.props.horizontal) return false;
      for (let p: HostNode | null = node.parent; p; p = p.parent) {
        if (p === host.current) {
          tracked = node;
          return true;
        }
      }
      return false;
    };
    return engine.scrolls.observe((node) => {
      if (!isTracked(node) || !node.scroll) return;
      const rest = engine.scrolls.bounds(node).minY;
      value.setValue(Math.max(0, Math.min(1, (node.scroll.y - rest) / BAR.ios.largeTitleHeight)));
    });
  }, [host, value]);
  return value;
}

/** RNSScreenStackHeaderSubview: custom content for the bar's left / center / right / back slot. */
export const HeaderSubview = forwardRef<any, any>(function HeaderSubview(props, ref) {
  const slots = useContext(HeaderSlotsContext);
  const type: string = props.type ?? 'left';
  useLayoutEffect(() => slots?.register(type), [slots, type]);
  const ios = Platform.OS === 'ios';
  const inset = ios ? BAR.ios.sideInset : 4;
  const position =
    type === 'right'
      ? { position: 'absolute', right: inset, top: 0, bottom: 0, justifyContent: 'center' }
      : type === 'center'
        ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }
        : type === 'searchBar'
          ? { display: 'none' }
          : { position: 'absolute', left: inset, top: 0, bottom: 0, justifyContent: 'center' };
  return React.createElement(View, { ref, pointerEvents: 'box-none', style: [props.style, position], children: props.children });
});
