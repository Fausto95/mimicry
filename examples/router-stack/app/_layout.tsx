import { Stack } from 'expo-router';

/** A native stack (react-native-screens) the way most expo-router apps use it. */
export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Inbox', headerLargeTitle: true }} />
      <Stack.Screen name="details" options={{ title: 'Message' }} />
      <Stack.Screen name="compose" options={{ title: 'New Message', presentation: 'modal' }} />
    </Stack>
  );
}
