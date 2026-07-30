import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const actions = [
  {
    icon: 'crosshairs-gps',
    label: 'Dónde estoy',
    description: 'Escuchar y ver tu dirección actual',
    route: '/where-am-i',
    accent: '#208AEF',
    background: 'rgba(32, 138, 239, 0.14)',
  },
  {
    icon: 'map-search-outline',
    label: 'Explorador de mapa',
    description: 'Buscar lugares y recorrer el mapa',
    route: '/map-explorer',
    accent: '#8D5BFF',
    background: 'rgba(141, 91, 255, 0.14)',
  },
  {
    icon: 'map-marker-radius-outline',
    label: 'Lugares cercanos',
    description: 'Encontrar comercios y servicios próximos',
    route: '/nearby-places',
    accent: '#4DAA57',
    background: 'rgba(77, 170, 87, 0.14)',
  },
] satisfies readonly {
  icon: MaterialIconName;
  label: string;
  description: string;
  route: string;
  accent: string;
  background: string;
}[];

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
            <Pressable
              accessibilityHint={action.description}
              accessibilityLabel={action.label}
              accessibilityRole="button"
              key={action.label}
              onPress={() => router.push(action.route as Href)}
              style={({ pressed }) => [
                styles.actionRow,
                pressed ? styles.actionRowPressed : null,
              ]}>
              <View style={[styles.rowIcon, { backgroundColor: action.background }]}>
                <MaterialCommunityIcons color={action.accent} name={action.icon} size={23} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{action.label}</Text>
                <Text style={styles.rowDescription}>{action.description}</Text>
              </View>
              <Ionicons color={action.accent} name="chevron-forward" size={21} />
            </Pressable>
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
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 11,
  },
  actionRowPressed: {
    opacity: 0.72,
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
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowDescription: {
    color: '#7F8A9B',
    fontSize: 12,
    lineHeight: 17,
  },
});
