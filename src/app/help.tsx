import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const scanActions = [
  { icon: 'text-recognition', label: 'Escanear texto', description: 'Leer en voz alta el texto de una imagen', mode: 'read_text' },
  { icon: 'image-search-outline', label: 'Escanear imagen', description: 'Describir objetos y escenas con la cámara', mode: 'describe_scene' },
  { icon: 'cash-multiple', label: 'Escanear billete', description: 'Identificar billetes argentinos', mode: 'identify_currency' },
] as const;

export default function HelpScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.glow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver al inicio"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/home')}
            style={styles.backButton}>
            <Ionicons color="#3C1642" name="arrow-back" size={23} />
          </Pressable>

          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>ASISTENCIA</Text>
            <Text style={styles.title}>Ayuda</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {scanActions.map((action) => (
            <Pressable
              key={action.mode}
              accessibilityLabel={action.label}
              accessibilityHint={action.description}
              accessibilityRole="button"
              onPress={() => router.push(`/visual-scanner?mode=${action.mode}` as Href)}
              style={[styles.card, styles.scanCard]}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons color="#FFFFFF" name={action.icon} size={30} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{action.label}</Text>
                <Text style={styles.cardDescription}>{action.description}</Text>
              </View>
              <Ionicons color="#286C3A" name="chevron-forward" size={24} />
            </Pressable>
          ))}
          <Pressable
            accessibilityHint="Usa el lente disponible o la cámara del celular"
            accessibilityLabel="Streaming en tiempo real"
            accessibilityRole="button"
            onPress={() => router.push('/realtime-streaming' as Href)}
            style={styles.card}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons color="#FFFFFF" name="video-wireless-outline" size={34} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Streaming en tiempo real</Text>
              <Text style={styles.cardDescription}>
                Usá la cámara del lente conectado o la de tu celular.
              </Text>
              <View style={styles.featureRow}>
                <MaterialCommunityIcons color="#72D68B" name="cctv" size={16} />
                <Text style={styles.featureText}>Lente o celular</Text>
              </View>
            </View>
            <Ionicons color="#72D68B" name="chevron-forward" size={27} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCFCFC' },
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
    backgroundColor: '#F2EDF3',
    borderWidth: 1,
    borderColor: '#DED5E0',
  },
  headerText: { flex: 1 },
  eyebrow: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  title: { color: '#3C1642', fontSize: 29, fontWeight: '900', marginTop: 2 },
  content: { paddingTop: 18, paddingBottom: 24, gap: 12 },
  scanCard: { minHeight: 112 },
  card: {
    minHeight: 184,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(114, 214, 139, 0.42)',
    backgroundColor: '#F1F8F3',
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
  cardTitle: { color: '#3C1642', fontSize: 20, lineHeight: 24, fontWeight: '900' },
  cardDescription: { color: '#4F3654', fontSize: 13, lineHeight: 19 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featureText: { color: '#286C3A', fontSize: 11, fontWeight: '800' },
});
