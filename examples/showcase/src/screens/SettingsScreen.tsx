import { useState } from 'react';
import { Appearance, Platform, PixelRatio, ScrollView, Switch, Text, useColorScheme, useWindowDimensions } from 'react-native';
import { Row, Section } from '@/components/ui';
import { useTheme } from '@/theme';

export function SettingsScreen() {
  const t = useTheme();
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [haptics, setHaptics] = useState(true);
  const value = (v: string) => <Text style={{ color: t.secondary, fontSize: 16 }}>{v}</Text>;

  return (
    <ScrollView testID="settings-scroll" contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <Section title="Environment" footer="Values come from the device descriptor the engine was booted with.">
        <Row title="Platform" right={value(`${Platform.OS} ${String(Platform.Version)}`)} />
        <Row title="Window" right={value(`${width} × ${height}`)} />
        <Row title="Pixel ratio" right={value(`${PixelRatio.get()}x`)} />
        <Row title="Color scheme" right={value(scheme ?? 'unknown')} />
        <Row title="Greeting (.env)" right={value(process.env.EXPO_PUBLIC_GREETING ?? '—')} last />
      </Section>
      <Section title="Preferences">
        <Row
          title="Dark appearance"
          subtitle="Appearance.setColorScheme()"
          right={<Switch testID="dark-switch" value={scheme === 'dark'} onValueChange={(on) => Appearance.setColorScheme(on ? 'dark' : 'light')} />}
        />
        <Row title="Haptics" last right={<Switch value={haptics} onValueChange={setHaptics} />} />
      </Section>
    </ScrollView>
  );
}
