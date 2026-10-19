import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Section } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Animated runs on the engine's frame clock: values are written straight to
 * host nodes, so none of these animations re-render React.
 */
export function MotionScreen() {
  const t = useTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  const spring = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const bar = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    bar.start();
    return () => {
      loop.stop();
      bar.stop();
    };
  }, [pulse, progress]);

  const toggle = () => {
    Animated.spring(spring, { toValue: open ? 0 : 1, friction: 6, tension: 70, useNativeDriver: true }).start();
    setOpen(!open);
  };

  const headerOpacity = scrollY.interpolate({ inputRange: [0, 80], outputRange: [1, 0], extrapolate: 'clamp' });
  const headerShift = scrollY.interpolate({ inputRange: [0, 80], outputRange: [0, -20], extrapolate: 'clamp' });

  return (
    <Animated.ScrollView
      testID="motion-scroll"
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 48 }}
    >
      <Animated.View style={{ opacity: headerOpacity, transform: [{ translateY: headerShift }], marginHorizontal: 20, marginBottom: 20 }}>
        <Text style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>
          Scroll this screen: the paragraph fades through Animated.event, without a React render per frame.
        </Text>
      </Animated.View>

      <Section title="Spring" footer="Animated.spring with friction 6, tension 70. Tap the card.">
        <Pressable testID="spring-card" onPress={toggle} style={{ height: 150, justifyContent: 'center', paddingHorizontal: 20 }}>
          <Animated.View
            style={[
              styles.blob,
              {
                backgroundColor: t.tint,
                transform: [
                  { translateX: spring.interpolate({ inputRange: [0, 1], outputRange: [0, 200] }) },
                  { rotate: spring.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) },
                  { scale: spring.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) },
                ],
                borderRadius: spring.interpolate({ inputRange: [0, 1], outputRange: [14, 40] }),
              },
            ]}
          />
        </Pressable>
      </Section>

      <Section title="Loop">
        <View style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={[
              styles.ring,
              {
                borderColor: t.tint,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
              },
            ]}
          />
        </View>
      </Section>

      <Section title="Timing">
        <View style={{ padding: 20, gap: 10 }}>
          <View style={[styles.track, { backgroundColor: t.fill }]}>
            <Animated.View
              style={[styles.fill, { backgroundColor: t.tint, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            />
          </View>
          <Text style={{ color: t.secondary, fontSize: 13 }}>Animated width — a layout property, so Yoga re-runs each frame.</Text>
        </View>
      </Section>

      {Array.from({ length: 6 }, (_, i) => (
        <Section key={i} title={`Filler ${i + 1}`}>
          <View style={{ height: 64 }} />
        </Section>
      ))}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  blob: { width: 72, height: 72 },
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
