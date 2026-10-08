import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ANNY_BOARD_FEATURES } from '@/lib/anny-board-features';

export default function AnnyBoardScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver al inicio"
            onPress={() => router.replace('/home')}
            style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>DISPOSITIVO</Text>
            <Text style={styles.title}>Lente Anny</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="memory" size={23} />
          </View>
        </View>

        <Text style={styles.intro}>
          Elegí una función de tu lente. Las nuevas capacidades aparecerán en esta sección.
        </Text>

        <View style={styles.features}>
          {ANNY_BOARD_FEATURES.map((feature) => (
            <Pressable
              accessibilityHint={feature.description}
              accessibilityLabel={feature.title}
              accessibilityRole="button"
              key={feature.id}
              onPress={() => router.push(feature.route as Href)}
              style={({ pressed }) => [
                styles.featureRow,
                pressed ? styles.featureRowPressed : null,
              ]}>
              <View style={[styles.featureIcon, { backgroundColor: feature.background }]}>
                <MaterialCommunityIcons color={feature.accent} name={feature.icon} size={26} />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
              <Ionicons color={feature.accent} name="chevron-forward" size={22} />
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCFCFC' },
  topGlow: {
    position: 'absolute',
    top: -160,
    right: -130,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(77, 170, 87, 0.18)',
  },
  safeArea: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DED5E0',
    backgroundColor: '#F2EDF3',
  },
  headerText: { flex: 1 },
  eyebrow: { color: '#72D68B', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: '#3C1642', fontSize: 19, fontWeight: '900', marginTop: 2 },
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#4DAA57',
  },
  intro: { color: '#5B465F', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  features: { gap: 10 },
  featureRow: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  featureRowPressed: { opacity: 0.72 },
  featureIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
  },
  featureText: { flex: 1, minWidth: 0, gap: 4 },
  featureTitle: { color: '#3C1642', fontSize: 15, fontWeight: '900' },
  featureDescription: { color: '#6F5873', fontSize: 12, lineHeight: 17 },
});
