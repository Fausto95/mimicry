import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const t = useTheme();
  const ios = Platform.OS === 'ios';
  return (
    <View style={{ marginBottom: 24 }}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: ios ? t.secondary : t.tint }, !ios && styles.sectionTitleAndroid]}>
          {ios ? title.toUpperCase() : title}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: t.card }, !ios && styles.cardAndroid]}>{children}</View>
      {footer ? <Text style={[styles.footer, { color: t.secondary }]}>{footer}</Text> : null}
    </View>
  );
}

export function Row({ title, subtitle, right, onPress, last, testID }: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: t.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }}
      style={({ pressed }) => [styles.row, pressed && Platform.OS === 'ios' && { backgroundColor: t.fill }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: Platform.OS === 'ios' ? 17 : 16, color: t.text }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 13, color: t.secondary }}>{subtitle}</Text> : null}
      </View>
      {right}
      {!last ? <View style={[styles.separator, { backgroundColor: t.separator }]} /> : null}
    </Pressable>
  );
}

export function Chevron() {
  const t = useTheme();
  return <Text style={{ fontSize: 20, color: t.secondary, marginLeft: 8 }}>›</Text>;
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, marginHorizontal: 20, marginBottom: 7 },
  sectionTitleAndroid: { fontSize: 14, fontWeight: '500', marginHorizontal: 20 },
  card: { marginHorizontal: 16, borderRadius: 10, overflow: 'hidden' },
  cardAndroid: { borderRadius: 16, elevation: 1 },
  footer: { fontSize: 13, marginHorizontal: 20, marginTop: 7, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, paddingVertical: 11 },
  separator: { position: 'absolute', left: 16, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
