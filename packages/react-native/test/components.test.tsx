import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Text, View, Pressable, Switch, ScrollView, StyleSheet, Platform, TextInput, Alert, Button } from 'react-native';
import { render } from '@mimicry/testing';

function Counter() {
  const [count, setCount] = useState(0);
  const [on, setOn] = useState(false);
  const [name, setName] = useState('');
  return (
    <View style={styles.root}>
      <Text testID="title" style={styles.title}>Count {count}</Text>
      <Pressable testID="inc" onPress={() => setCount((c) => c + 1)} style={({ pressed }: { pressed: boolean }) => [styles.button, pressed && { opacity: 0.5 }]}>
        <Text style={{ color: 'white', fontWeight: '600' }}>Increment</Text>
      </Pressable>
      <Switch testID="switch" value={on} onValueChange={setOn} />
      <Text testID="state">{on ? 'on' : 'off'} · {Platform.OS}</Text>
      <TextInput testID="name" value={name} onChangeText={setName} placeholder="Name" style={styles.input} />
      <Text testID="hello">Hello {name}</Text>
      <Button title="Alert" onPress={() => Alert.alert('Title', 'Message', [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', onPress: () => setCount(100) }])} />
      <ScrollView testID="scroll" style={{ height: 200 }}>
        {Array.from({ length: 30 }, (_, i) => <Text key={i} style={{ padding: 10 }}>Row {i}</Text>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 70, paddingHorizontal: 16, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  button: { backgroundColor: '#007aff', padding: 12, borderRadius: 10, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 },
});

describe('react-native components', () => {
  it('handles taps, switches, text input, alerts and scroll on iOS', async () => {
    const s = await render(<Counter />, { device: 'iphone-17-pro' });
    expect(s.text({ testID: 'title' })).toEqual(['Count 0']);
    s.tap({ testID: 'inc' }).tap({ testID: 'inc' });
    expect(s.text({ testID: 'title' })).toEqual(['Count 2']);
    s.tap({ testID: 'switch' }).settle();
    expect(s.text({ testID: 'state' })).toEqual(['on · ios']);
    s.type({ testID: 'name' }, 'Ada');
    expect(s.text({ testID: 'hello' })).toEqual(['Hello Ada']);
    s.tap({ text: 'Alert' });
    expect(s.exists({ testID: 'alert' })).toBe(true);
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/rn-alert.png', s.screenshot(2));
    s.tap({ text: 'OK' });
    expect(s.exists({ testID: 'alert' })).toBe(false);
    expect(s.text({ testID: 'title' })).toEqual(['Count 100']);
    s.scroll({ testID: 'scroll' }, { dy: 150 }).settle();
    const scroll = s.engine.nodes.get(s.find({ testID: 'scroll' })[0]!.id)!;
    expect(scroll.scroll!.y).toBeGreaterThan(100);
    writeFileSync('artifacts/rn-ios.png', s.screenshot(2));
    expect(s.errors).toEqual([]);
    s.dispose();
  });

  it('renders the Android kit', async () => {
    const s = await render(<Counter />, { device: 'pixel-9' });
    expect(s.text({ testID: 'state' })).toEqual(['off · android']);
    s.tap({ text: 'ALERT' });
    writeFileSync('artifacts/rn-android.png', s.screenshot(2));
    expect(s.errors).toEqual([]);
    s.dispose();
  });
});
