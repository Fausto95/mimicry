import React from 'react';
import { StatusBar as RNStatusBar } from '../components/primitives';

/** expo-status-bar: `style` is relative to the color scheme ('auto' = dark text in light mode). */
type Style = 'auto' | 'inverted' | 'light' | 'dark';

export function StatusBar(props: { style?: Style; hidden?: boolean; backgroundColor?: string; translucent?: boolean; animated?: boolean }) {
  const barStyle = props.style === 'light' ? 'light-content' : props.style === 'dark' ? 'dark-content' : 'default';
  return React.createElement(RNStatusBar as any, { barStyle, hidden: props.hidden, backgroundColor: props.backgroundColor });
}

export const setStatusBarStyle = (style: Style) =>
  (RNStatusBar as any).setBarStyle(style === 'light' ? 'light-content' : style === 'dark' ? 'dark-content' : 'default');
export const setStatusBarHidden = (hidden: boolean) => (RNStatusBar as any).setHidden(hidden);
export const setStatusBarBackgroundColor = (color: string) => (RNStatusBar as any).setBackgroundColor(color);
export const setStatusBarTranslucent = () => {};
export const setStatusBarNetworkActivityIndicatorVisible = () => {};
