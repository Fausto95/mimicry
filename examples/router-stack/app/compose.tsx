import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function Compose() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>To: everyone@example.com</Text>
      <Pressable testID="close" onPress={() => router.back()} style={styles.button}>
        <Text style={styles.buttonText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  label: { fontSize: 17 },
  button: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: '#e5e5ea' },
  buttonText: { fontSize: 17, color: '#007aff' },
});
