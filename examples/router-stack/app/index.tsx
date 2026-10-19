import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const SENDERS = ['Ada Lovelace', 'Grace Hopper', 'Alan Kay', 'Barbara Liskov', 'Edsger Dijkstra', 'Margaret Hamilton', 'Donald Knuth', 'Radia Perlman', 'Ken Thompson', 'Frances Allen', 'John McCarthy', 'Leslie Lamport'];

export default function Inbox() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.list}>
      <Link href="/compose" asChild>
        <Pressable testID="compose" style={styles.compose}>
          <Text style={styles.composeText}>New Message</Text>
        </Pressable>
      </Link>
      {SENDERS.map((name, i) => (
        <Link key={name} href={{ pathname: '/details', params: { id: String(i) } }} asChild>
          <Pressable testID={`row-${i}`} style={styles.row}>
            <Text style={styles.sender}>{name}</Text>
            <Text style={styles.preview} numberOfLines={1}>Re: the meeting on Thursday, and a few notes on the draft</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  compose: { margin: 16, padding: 12, borderRadius: 10, backgroundColor: '#007aff', alignItems: 'center' },
  composeText: { color: 'white', fontSize: 17, fontWeight: '600' },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#c6c6c8' },
  sender: { fontSize: 17, fontWeight: '600' },
  preview: { fontSize: 15, color: '#8e8e93', marginTop: 2 },
});
