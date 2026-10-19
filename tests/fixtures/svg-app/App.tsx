import React, { useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import Svg, {
  Circle, ClipPath, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Symbol, Text as SvgText, Use,
} from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Each case sits in its own 100×100 cell so the test can probe known pixels. */
const cell = (left: number, top: number) => ({ position: 'absolute' as const, left, top });

export default function App() {
  const [taps, setTaps] = useState(0);
  const radius = useRef(new Animated.Value(10)).current;
  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      {/* viewBox scaling: a 10×10 triangle drawn into 100×100 */}
      <Svg testID="viewbox" width={100} height={100} viewBox="0 0 10 10" style={cell(0, 100)}>
        <Path d="M0 0 L10 0 L10 10 Z" fill="red" />
      </Svg>

      {/* linear gradient (objectBoundingBox), left blue → right lime */}
      <Svg testID="gradient" width={100} height={100} style={cell(100, 100)}>
        <Defs>
          <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#0000ff" />
            <Stop offset="1" stopColor="#00ff00" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#lg)" />
      </Svg>

      {/* dashed stroke: long dashes along a horizontal line */}
      <Svg testID="dash" width={100} height={100} style={cell(200, 100)}>
        <Line x1="0" y1="50" x2="100" y2="50" stroke="black" strokeWidth={10} strokeDasharray="20 20" />
      </Svg>

      {/* clipPath: a square clipped to a circle */}
      <Svg testID="clip" width={100} height={100} style={cell(300, 100)}>
        <Defs>
          <ClipPath id="round">
            <Circle cx="50" cy="50" r="30" />
          </ClipPath>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="purple" clipPath="url(#round)" />
      </Svg>

      {/* inheritance through <G>, percentages, <Use> of a <Symbol>, radial gradient */}
      <Svg testID="group" width={100} height={100} style={cell(0, 200)}>
        <Defs>
          <Symbol id="dot" viewBox="0 0 2 2">
            <Circle cx="1" cy="1" r="1" />
          </Symbol>
          <RadialGradient id="rg" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#000000" />
          </RadialGradient>
        </Defs>
        <G fill="orange">
          <Rect x="0" y="0" width="50%" height="50%" />
        </G>
        <Use href="#dot" x="50" y="0" width="50" height="50" fill="teal" />
        <Rect x="0" y="50" width="100" height="50" fill="url(#rg)" />
      </Svg>

      {/* touchable shape */}
      <Svg testID="press" width={100} height={100} style={cell(100, 200)}>
        <Circle testID="press-target" cx="50" cy="50" r="40" fill="navy" onPress={() => setTaps((n) => n + 1)} />
      </Svg>
      <Text testID="taps" style={cell(100, 310)}>{String(taps)}</Text>

      {/* animated radius */}
      <Svg testID="animated" width={100} height={100} style={cell(200, 200)}>
        <AnimatedCircle cx="50" cy="50" r={radius} fill="green" />
      </Svg>
      <Pressable
        testID="grow"
        style={[cell(200, 310), { width: 60, height: 30, backgroundColor: '#ddd' }]}
        onPress={() => Animated.timing(radius, { toValue: 45, duration: 300, useNativeDriver: false }).start()}
      />

      {/* text */}
      <Svg testID="text" width={100} height={100} style={cell(300, 200)}>
        <SvgText x="50" y="60" fontSize="40" fontWeight="bold" fill="black" textAnchor="middle">
          A
        </SvgText>
      </Svg>
    </View>
  );
}
