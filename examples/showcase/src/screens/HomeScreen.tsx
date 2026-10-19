import { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PlatformBadge } from '@/components/PlatformBadge';
import { Chevron, Row, Section } from '@/components/ui';
import { useTheme } from '@/theme';

const avatar = require('../../assets/avatar.png');

const PEOPLE = [
  { id: '1', name: 'Ada Lovelace', note: 'Reviewed the layout engine' },
  { id: '2', name: 'Grace Hopper', note: 'Shipped the compiler' },
  { id: '3', name: 'Alan Kay', note: 'Left a comment on Dynabook.tsx' },
];

export function HomeScreen({ onPresentSheet }: { onPresentSheet: () => void }) {
  const t = useTheme();
  const { width, height, scale } = useWindowDimensions();
  const [taps, setTaps] = useState(0);

  return (
    <ScrollView testID="home-scroll" contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
      <LinearGradient
        colors={Platform.OS === 'ios' ? ['#5e5ce6', '#bf5af2'] : ['#3949ab', '#00897b']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <PlatformBadge />
        <Text style={styles.heroTitle}>Native UI,{'\n'}drawn by Mimicry.</Text>
        <Text style={styles.heroBody}>
          React reconciles into a retained tree, Yoga lays it out, and the engine streams draw commands to a canvas.
        </Text>
        <View style={styles.heroMeta}>
          <Text style={styles.heroMetaText}>{Platform.OS === 'ios' ? 'iOS' : 'Android'} {String(Platform.Version)}</Text>
          <Text style={styles.heroMetaText}>{width}×{height} @{scale}x</Text>
        </View>
      </LinearGradient>

      <View style={styles.stats}>
        <Pressable
          testID="tap-card"
          onPress={() => setTaps((n) => n + 1)}
          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
          style={({ pressed }) => [styles.stat, { backgroundColor: t.card, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <Text style={[styles.statValue, { color: t.text }]} testID="tap-count">{taps}</Text>
          <Text style={[styles.statLabel, { color: t.secondary }]}>Taps</Text>
        </Pressable>
        <View style={[styles.stat, { backgroundColor: t.card }]}>
          <Text style={[styles.statValue, { color: t.text }]}>60</Text>
          <Text style={[styles.statLabel, { color: t.secondary }]}>fps target</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: t.card }]}>
          <Text style={[styles.statValue, { color: t.text }]}>0</Text>
          <Text style={[styles.statLabel, { color: t.secondary }]}>Simulators</Text>
        </View>
      </View>

      <Section title="Recent activity">
        {PEOPLE.map((p, i) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16 }}>
            <Image source={avatar} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Row title={p.name} subtitle={p.note} last={i === PEOPLE.length - 1} right={<Chevron />} onPress={() => {}} />
            </View>
          </View>
        ))}
      </Section>

      <Section title="Presentation" footer="Opens a Modal with presentationStyle='pageSheet' — a card over the scaled-back app on iOS.">
        <Row testID="present-sheet" title="Present a sheet" onPress={onPresentSheet} last right={<Chevron />} />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: 16, marginBottom: 16, borderRadius: Platform.OS === 'ios' ? 22 : 28, padding: 20, gap: 10 },
  heroTitle: { color: 'white', fontSize: 30, fontWeight: '700', letterSpacing: -0.6, lineHeight: 34, marginTop: 6 },
  heroBody: { color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 21 },
  heroMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  heroMetaText: { color: 'white', fontSize: 13, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 24 },
  stat: { flex: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 12, gap: 2, overflow: 'hidden' },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
