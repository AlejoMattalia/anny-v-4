import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * El flujo del lente Bluetooth anterior queda fuera de la interfaz.
 * Sus módulos se conservan en el repositorio por si se necesita recuperarlo.
 */
export default function DevicesScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Dispositivos</Text>
            <Text style={styles.subtitle}>Conexión del lente Anny</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="glasses" size={23} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.deviceCard}>
            <View style={styles.deviceIcon}>
              <MaterialCommunityIcons color="#72D68B" name="video-wireless-outline" size={34} />
            </View>
            <Text style={styles.deviceTitle}>Lentes con cámara ESP32</Text>
            <Text style={styles.deviceDescription}>
              Vinculá el lente con su código de activación y enviale el WiFi del lugar.
            </Text>
            <Pressable
              accessibilityLabel="Conectar lentes con cámara ESP32"
              onPress={() => router.push('/esp32-camera-setup' as Href)}
              style={styles.primaryButton}>
              <MaterialCommunityIcons color="#FFFFFF" name="connection" size={20} />
              <Text style={styles.primaryButtonText}>Conectar lente</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070B' },
  topGlow: { position: 'absolute', top: -160, right: -130, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(77,170,87,.18)' },
  safeArea: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0D141D' },
  headerText: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#7F8A9B', fontSize: 11, marginTop: 2 },
  headerBadge: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#4DAA57' },
  content: { paddingTop: 18, paddingBottom: 34 },
  deviceCard: { alignItems: 'center', gap: 13, borderWidth: 1, borderColor: '#315C43', borderRadius: 14, backgroundColor: 'rgba(77,170,87,.1)', padding: 24 },
  deviceIcon: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 35, backgroundColor: 'rgba(77,170,87,.17)' },
  deviceTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  deviceDescription: { color: '#AFC9B6', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  primaryButton: { width: '100%', minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 9, backgroundColor: '#4DAA57', marginTop: 5 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
