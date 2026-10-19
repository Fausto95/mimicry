import React, { forwardRef } from 'react';
import { View } from '../../components/primitives';
import { registerNativeComponents, registerNativeModules } from '../registry';
import { HeaderConfig, HeaderSubview } from './header';
import { Screen, ScreenContainer } from './screen';
import { ScreenStack } from './stack';
import { TabsBottomAccessory, TabsBottomAccessoryContent, TabsHost, TabsScreen } from './tabs';

/**
 * react-native-screens' native side. The library's JavaScript (vendored,
 * whatever version the app installs) renders these native components.
 */
const passthrough = (name: string, extra?: (props: any) => object) => {
  const C = forwardRef<any, any>(function NativeView(props, ref) {
    return React.createElement(View, { ...props, ...(extra?.(props) ?? null), ref });
  });
  C.displayName = name;
  return C;
};

registerNativeComponents({
  RNSScreenStack: ScreenStack,
  RNSScreen: Screen,
  RNSModalScreen: Screen,
  RNSScreenStackHeaderConfig: HeaderConfig,
  RNSScreenStackHeaderSubview: HeaderSubview,
  RNSScreenContainer: ScreenContainer,
  RNSScreenNavigationContainer: ScreenContainer,
  RNSTabsHostIOS: TabsHost,
  RNSTabsHostAndroid: TabsHost,
  RNSTabsScreenIOS: TabsScreen,
  RNSTabsScreenAndroid: TabsScreen,
  RNSTabsBottomAccessory: TabsBottomAccessory,
  RNSTabsBottomAccessoryContent: TabsBottomAccessoryContent,
  // RNSSafeAreaView pads by the view's own safe area, like RNCSafeAreaView
  RNSSafeAreaView: passthrough('RNSSafeAreaView', (p) => ({ safeAreaEdges: p.edges ?? { top: true, right: true, bottom: true, left: true } })),
  RNSScreenContentWrapper: passthrough('RNSScreenContentWrapper'),
  RNSScreenFooter: passthrough('RNSScreenFooter', () => ({ style: { position: 'absolute', left: 0, right: 0, bottom: 0 } })),
  RNSFullWindowOverlay: passthrough('RNSFullWindowOverlay', (p) => ({ pointerEvents: 'box-none', style: [{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }, p.style] })),
  RNSScrollViewMarker: passthrough('RNSScrollViewMarker'),
  RNSScrollToTopGuard: passthrough('RNSScrollToTopGuard'),
  RNSSearchBar: passthrough('RNSSearchBar', () => ({ style: { display: 'none' } })),
});

registerNativeModules({
  RNSModule: () => ({}),
});
