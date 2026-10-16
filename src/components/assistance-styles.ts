import { StyleSheet } from 'react-native';
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCFCFC' }, content: { padding: 24, gap: 20 },
  title: { fontSize: 30, fontWeight: '800', color: '#3C1642' }, subtitle: { fontSize: 22, fontWeight: '700', color: '#3C1642' },
  description: { fontSize: 18, lineHeight: 27, color: '#444' }, link: { color: '#6A0DAD', fontSize: 18, fontWeight: '600' },
  button: { padding: 20, borderRadius: 18, backgroundColor: '#3C1642', alignItems: 'center' }, buttonText: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  secondary: { paddingVertical: 16, minHeight: 48 }, card: { padding: 20, backgroundColor: '#F0EAF2', borderRadius: 20, gap: 16 },
  error: { fontSize: 17, color: '#A51635', lineHeight: 24 }, input: { borderWidth: 1, borderColor: '#C5B9CA', borderRadius: 12, padding: 16, fontSize: 18, color: '#212121' },
});
