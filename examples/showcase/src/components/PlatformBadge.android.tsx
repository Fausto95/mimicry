import { Text, View } from 'react-native';

/** Resolved only for Android builds. */
export function PlatformBadge() {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' }}>
      <Text style={{ color: 'white', fontSize: 12, fontWeight: '500', letterSpacing: 0.4 }}>PLATFORMBADGE.ANDROID.TSX</Text>
    </View>
  );
}
