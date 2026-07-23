import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const actions = [
  { icon: 'camera-outline', label: 'Cámara' },
  { icon: 'text-recognition', label: 'Leer texto' },
  { icon: 'cash-multiple', label: 'Billetes' },
] as const;

export default function ExploreScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <Text style={styles.title}>Explorar</Text>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="eye-outline" size={23} />
          </View>
        </View>

        <View style={styles.actions}>
          {actions.map((action) => (
            <View key={action.label} style={styles.actionRow}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons color="#B18CFF" name={action.icon} size={22} />
              </View>
              <Text style={styles.rowTitle}>{action.label}</Text>
              <Text style={styles.soonText}>Próximamente</Text>
            </View>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070B',
  },
  topGlow: {
    position: 'absolute',
    top: -160,
    right: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(141, 91, 255, 0.18)',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0D141D',
  },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
  },
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#8D5BFF',
  },
  actions: {
    gap: 10,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 11,
  },
  rowIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: 'rgba(141, 91, 255, 0.14)',
  },
  rowTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  soonText: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});
