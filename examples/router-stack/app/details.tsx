import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function Details() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={styles.container}>
      <Text testID="details-title" style={styles.title}>Message #{id}</Text>
      <Text style={styles.body}>Pushed with the native stack: the header, back button and transition come from react-native-screens.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 24, color: '#3c3c43' },
});
