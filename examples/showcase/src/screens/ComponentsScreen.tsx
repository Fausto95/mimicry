import { useState } from 'react';
import {
  ActivityIndicator, Alert, Button, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableHighlight, TouchableOpacity, View,
} from 'react-native';
import { Row, Section } from '@/components/ui';
import { useTheme } from '@/theme';

export function ComponentsScreen() {
  const t = useTheme();
  const [notifications, setNotifications] = useState(true);
  const [sync, setSync] = useState(false);
  const [name, setName] = useState('');
  const [presses, setPresses] = useState(0);

  return (
    <ScrollView testID="components-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <Section title="Switch" footer="UISwitch on iOS, SwitchCompat on Android — drawn by the platform kit.">
        <Row title="Notifications" right={<Switch testID="notifications" value={notifications} onValueChange={setNotifications} />} />
        <Row title="Background sync" subtitle={sync ? 'On' : 'Off'} last right={<Switch testID="sync" value={sync} onValueChange={setSync} />} />
      </Section>

      <Section title="Text input">
        <View style={{ padding: 16, gap: 10 }}>
          <TextInput
            testID="name-input"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            style={[styles.input, { color: t.text, backgroundColor: t.fill }]}
          />
          <Text testID="greeting" style={{ color: t.secondary }}>
            {name ? `Hello, ${name}!` : 'Type something — the native input lives on top of the canvas.'}
          </Text>
        </View>
      </Section>

      <Section title="Buttons">
        <View style={{ padding: 16, gap: 12 }}>
          <Button title="React Native Button" onPress={() => setPresses((n) => n + 1)} />
          <Pressable
            testID="pressable"
            onPress={() => setPresses((n) => n + 1)}
            android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
            style={({ pressed }) => [styles.primary, { backgroundColor: t.tint, opacity: Platform.OS === 'ios' && pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.primaryText}>Pressable · {presses}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity style={[styles.secondary, { backgroundColor: t.fill }]} onPress={() => setPresses((n) => n + 1)}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Opacity</Text>
            </TouchableOpacity>
            <TouchableHighlight underlayColor={t.dark ? '#3a3a40' : '#d8d8e0'} style={[styles.secondary, { backgroundColor: t.fill }]} onPress={() => setPresses((n) => n + 1)}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Highlight</Text>
            </TouchableHighlight>
          </View>
        </View>
      </Section>

      <Section title="Feedback">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 18 }}>
          <ActivityIndicator />
          <ActivityIndicator size="large" />
          <ActivityIndicator size="large" color="#ff375f" />
        </View>
        <Row
          testID="show-alert"
          title="Show an alert"
          last
          onPress={() =>
            Alert.alert('Delete draft?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => setName('') },
            ])
          }
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  primary: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', overflow: 'hidden' },
  primaryText: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondary: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
});
