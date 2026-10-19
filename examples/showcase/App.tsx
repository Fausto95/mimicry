import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from '@/screens/HomeScreen';
import { ComponentsScreen } from '@/screens/ComponentsScreen';
import { MotionScreen } from '@/screens/MotionScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { useTheme, type Theme } from '@/theme';

type Tab = 'home' | 'components' | 'motion' | 'settings';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'components', label: 'Components' },
  { key: 'motion', label: 'Motion' },
  { key: 'settings', label: 'Settings' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState(false);
  const title = TABS.find((x) => x.key === tab)!.label;
  const ios = Platform.OS === 'ios';

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style="auto" />
      <View style={[ios ? styles.largeHeader : styles.appBar, { paddingTop: insets.top + (ios ? 8 : 0), backgroundColor: ios ? undefined : t.card }]}>
        <Text style={[ios ? styles.largeTitle : styles.appBarTitle, { color: t.text }]} testID="screen-title">{title}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen onPresentSheet={() => setSheet(true)} />}
        {tab === 'components' && <ComponentsScreen />}
        {tab === 'motion' && <MotionScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
      <TabBar tab={tab} onChange={setTab} theme={t} bottom={insets.bottom} />
      <Modal visible={sheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(false)}>
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <View style={[styles.grabber, { backgroundColor: t.separator }]} />
          <Text style={[styles.sheetTitle, { color: t.text }]}>A modal sheet</Text>
          <Text style={{ color: t.secondary, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>
            The engine lays modals out against the window and presents them with the platform's transition.
          </Text>
          <Pressable testID="dismiss-sheet" onPress={() => setSheet(false)} style={[styles.sheetButton, { backgroundColor: t.tint }]}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function TabIcon({ name, color }: { name: Tab; color: string }) {
  switch (name) {
    case 'home':
      return <View style={{ width: 20, height: 18, borderWidth: 2, borderColor: color, borderRadius: 5, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />;
    case 'components':
      return (
        <View style={{ width: 20, height: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 8.5, height: 8.5, borderRadius: 2.5, backgroundColor: color }} />)}
        </View>
      );
    case 'motion':
      return <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /></View>;
    case 'settings':
      return (
        <View style={{ width: 20, height: 18, justifyContent: 'space-between' }}>
          {[14, 20, 10].map((w, i) => <View key={i} style={{ width: w, height: 2.5, borderRadius: 2, backgroundColor: color }} />)}
        </View>
      );
  }
}

function TabBar({ tab, onChange, theme, bottom }: { tab: Tab; onChange: (t: Tab) => void; theme: Theme; bottom: number }) {
  const ios = Platform.OS === 'ios';
  const active = ios ? (theme.dark ? '#0a84ff' : '#007aff') : (theme.dark ? '#9fa8ff' : '#4f5bd5');
  const inactive = theme.dark ? '#8e8e93' : '#8a8a8e';
  return (
    <View style={[styles.tabBar, { paddingBottom: bottom, backgroundColor: theme.card, borderTopColor: theme.separator }]}>
      {TABS.map(({ key, label }) => {
        const selected = key === tab;
        const color = selected ? active : inactive;
        return (
          <Pressable key={key} testID={`tab-${key}`} onPress={() => onChange(key)} android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: true }} style={styles.tab}>
            {!ios && selected ? (
              <View style={[styles.pill, { backgroundColor: theme.dark ? '#2f3263' : '#e2e5ff' }]}><TabIcon name={key} color={color} /></View>
            ) : (
              <View style={!ios ? styles.pillSpace : null}><TabIcon name={key} color={color} /></View>
            )}
            <Text style={{ fontSize: ios ? 10 : 12, fontWeight: ios ? '500' : selected ? '600' : '400', color: ios ? color : theme.text }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  largeHeader: { paddingHorizontal: 16, paddingBottom: 8 },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
  appBar: { paddingHorizontal: 16, height: undefined, paddingBottom: 16, elevation: 0 },
  appBarTitle: { fontSize: 22, marginTop: 18 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6, gap: 4 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pillSpace: { width: 56, height: 30, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 10, gap: 14 },
  grabber: { width: 36, height: 5, borderRadius: 3, marginBottom: 24 },
  sheetTitle: { fontSize: 24, fontWeight: '700' },
  sheetButton: { marginTop: 10, paddingHorizontal: 40, paddingVertical: 13, borderRadius: 12 },
});
