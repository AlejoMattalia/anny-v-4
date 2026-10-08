import { router } from 'expo-router';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useWifiLens } from '@/context/wifi-lens-context';

export function WifiLensConnectionCard({ showManage = true, compact = false }: { showManage?: boolean; compact?: boolean }) {
  const { wifiLensConnection: connection, networkPreference, setNetworkPreference } = useWifiLens();
  const actualType = connection.session?.networkType ?? networkPreference;
  const label = connection.phase === 'connected'
    ? `Conectado a ${actualType === 'hotspot' ? 'Hotspot' : 'WiFi'}: ${connection.ssid}`
    : connection.message || 'Lente no conectado';
  return <View style={compact ? styles.compact : styles.card}>
    {!compact ? <Text style={styles.title}>Lentes WiFi</Text> : null}
    <View style={styles.row}>
      <Text style={[styles.label, compact && styles.smallLabel]}>WiFi</Text>
      <Switch accessibilityLabel="Cambiar entre WiFi y Hotspot" value={networkPreference === 'hotspot'} onValueChange={(value) => void setNetworkPreference(value ? 'hotspot' : 'wifi')} trackColor={{ false: '#3C1642', true: '#3C1642' }} thumbColor="#FFFFFF" />
      <Text style={[styles.label, compact && styles.smallLabel]}>Hotspot</Text>
    </View>
    {!compact ? <Text accessibilityLiveRegion="polite" style={styles.status}>{label}</Text> : null}
    {showManage ? <Pressable accessibilityRole="button" onPress={() => router.push('/bluetooth-devices')}><Text style={styles.link}>Administrar conexión</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { borderColor: '#DED5E0', borderWidth: 1, borderRadius: 12, backgroundColor: '#F2EDF3', padding: 18, gap: 10 },
  compact: { alignSelf: 'flex-start' }, smallLabel: { fontSize: 13 },
  title: { color: '#3C1642', fontSize: 20, fontWeight: '800' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8 },
  label: { color: '#3C1642', fontSize: 17, fontWeight: '700' }, status: { color: '#3C1642', fontSize: 15 }, link: { color: '#6A0DAD', fontSize: 16, fontWeight: '700', paddingVertical: 6 },
});
