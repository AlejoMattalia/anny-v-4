import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HelpScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.glow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver al inicio"
            onPress={() => router.back()}
            style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="arrow-back" size={23} />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>ASISTENCIA</Text>
            <Text style={styles.title}>Ayuda</Text>
          </View>
        </View>

        <View style={styles.content}>
          <Pressable
            accessibilityHint="Muestra las cámaras de los lentes vinculados a tu cuenta"
            accessibilityLabel="Streaming en tiempo real de Lente Anny"
            accessibilityRole="button"
            onPress={() => router.push('/remote-cameras' as Href)}
            style={styles.card}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons color="#FFFFFF" name="video-wireless-outline" size={34} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Streaming en tiempo real</Text>
              <Text style={styles.cardDescription}>
                Mirá en vivo las cámaras de los lentes Anny vinculados a tu cuenta.
              </Text>
              <View style={styles.featureRow}>
                <MaterialCommunityIcons color="#72D68B" name="cctv" size={16} />
                <Text style={styles.featureText}>Cámaras de Lente Anny</Text>
              </View>
            </View>
            <Ionicons color="#72D68B" name="chevron-forward" size={27} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070B' },
  glow: {
    position: 'absolute',
    right: -120,
    top: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(77, 170, 87, 0.16)',
  },
  safeArea: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 72, gap: 14 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101722',
    borderWidth: 1,
    borderColor: '#263244',
  },
  headerText: { flex: 1 },
  eyebrow: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  title: { color: '#FFFFFF', fontSize: 29, fontWeight: '900', marginTop: 2 },
  content: { paddingTop: 18 },
  card: {
    minHeight: 184,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(114, 214, 139, 0.42)',
    backgroundColor: 'rgba(30, 78, 47, 0.62)',
    padding: 18,
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4DAA57',
  },
  cardBody: { flex: 1, gap: 8 },
  cardTitle: { color: '#FFFFFF', fontSize: 20, lineHeight: 24, fontWeight: '900' },
  cardDescription: { color: '#D3DAE5', fontSize: 13, lineHeight: 19 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featureText: { color: '#AEEABD', fontSize: 11, fontWeight: '800' },
});
