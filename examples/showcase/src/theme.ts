import { Platform, PlatformColor, useColorScheme } from 'react-native';

/** One palette per platform; iOS reads UIKit semantic colors through PlatformColor. */
export function useTheme() {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'ios') {
    return {
      dark,
      background: PlatformColor('systemGroupedBackground'),
      card: PlatformColor('secondarySystemGroupedBackground'),
      text: PlatformColor('label'),
      secondary: PlatformColor('secondaryLabel'),
      separator: PlatformColor('separator'),
      tint: PlatformColor('systemBlue'),
      fill: PlatformColor('tertiarySystemFill'),
    };
  }
  return {
    dark,
    background: dark ? '#121212' : '#f6f6f8',
    card: dark ? '#1e1e22' : '#ffffff',
    text: dark ? '#f2f2f5' : '#16161a',
    secondary: dark ? '#a5a5ad' : '#6b6b74',
    separator: dark ? '#2c2c31' : '#e4e4ea',
    tint: dark ? '#9fa8ff' : '#4f5bd5',
    fill: dark ? '#2a2a30' : '#ececf2',
  };
}

export type Theme = ReturnType<typeof useTheme>;
