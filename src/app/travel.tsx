import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface TravelOption {
  id: string;
  title: string;
  icon: MaterialIconName;
  accent: string;
  bgAlpha: string;
}

const travelOptions: TravelOption[] = [
  {
    id: 'plan',
    title: 'Planificar viaje',
    icon: 'map-marker-plus-outline',
    accent: '#208AEF',
    bgAlpha: 'rgba(32, 138, 239, 0.14)',
  },
  {
    id: 'start',
    title: 'Iniciar viaje ahora',
    icon: 'navigation-variant-outline',
    accent: '#4DAA57',
    bgAlpha: 'rgba(77, 170, 87, 0.14)',
  },
  {
    id: 'simulate',
    title: 'Simular viaje',
    icon: 'map-clock-outline',
    accent: '#D79B00',
    bgAlpha: 'rgba(215, 155, 0, 0.14)',
  },
  {
    id: 'saved',
    title: 'Viajes guardados',
    icon: 'folder-heart-outline',
    accent: '#B18CFF',
    bgAlpha: 'rgba(177, 140, 255, 0.14)',
  },
  {
    id: 'locations',
    title: 'Mis ubicaciones',
    icon: 'bookmark-outline',
    accent: '#E9528A',
    bgAlpha: 'rgba(233, 82, 138, 0.14)',
  },
];

export default function TravelScreen() {
  const handlePressOption = async (option: TravelOption) => {
    switch (option.id) {
      case 'plan':
        router.push('/plan-trip');
        break;
      case 'start':
        router.push('/start-trip');
        break;
      case 'simulate':
        router.push({
          pathname: '/start-trip',
          params: { mode: 'simulate' },
        });
        break;
      case 'saved':
        router.push('/saved-trips');
        break;
      case 'locations':
        router.push('/saved-locations');
        break;
      default:
        break;
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver al inicio" onPress={() => router.replace('/home')} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Viajar</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="map-legend" size={21} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            {travelOptions.map((option) => (
              <Pressable
                accessibilityLabel={option.title}
                key={option.id}
                onPress={() => handlePressOption(option)}
                style={styles.settingRow}
              >
                <View style={[styles.rowIcon, { backgroundColor: option.bgAlpha }]}>
                  <MaterialCommunityIcons color={option.accent} name={option.icon} size={22} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{option.title}</Text>
                </View>
                <Ionicons color={option.accent} name="chevron-forward" size={20} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
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
    backgroundColor: 'rgba(32, 138, 239, 0.15)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(124, 76, 255, 0.15)',
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
    marginBottom: 10,
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
  headerText: {
    flex: 1,
  },
  title: {
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
    backgroundColor: '#208AEF',
  },
  content: {
    paddingBottom: 18,
  },
  section: {
    marginBottom: 16,
  },
  settingRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  rowIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
