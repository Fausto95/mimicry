import { Text, View } from 'react-native';

/** Resolved only for iOS builds — Mimicry picks *.ios.tsx like Metro does. */
export function PlatformBadge() {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' }}>
      <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>PlatformBadge.ios.tsx</Text>
    </View>
  );
}
