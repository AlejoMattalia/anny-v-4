import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TravelModePicker, {
  TravelMode,
} from '@/components/travel-mode-picker';
import {
  CurrentLocation,
  getCurrentLocation,
} from '@/lib/current-location';
import {
  getNearbyPlaces,
  NearbyPlace,
} from '@/lib/nearby-places';
import { speak } from '@/lib/voice';

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${distanceMeters} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function getCategoryIcon(category: string) {
  if (/restaurant|cafe|bar|food/i.test(category)) return 'silverware-fork-knife';
  if (/hospital|clinic|pharmacy|health/i.test(category)) return 'medical-bag';
  if (/bus|transport|station/i.test(category)) return 'bus-marker';
  if (/shop|store|supermarket|market/i.test(category)) return 'storefront-outline';
  if (/school|college|university/i.test(category)) return 'school-outline';
  return 'map-marker-outline';
}

export default function NearbyPlacesScreen() {
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tripPlace, setTripPlace] = useState<NearbyPlace | null>(null);

  const loadPlaces = useCallback(async (forceRefresh = false) => {
    setError('');
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const current = await getCurrentLocation({
        allowCached: !forceRefresh,
      });
      setLocation(current);
      const nearby = await getNearbyPlaces(current);
      setPlaces(nearby);

      if (nearby.length === 0) {
        await speak('No encontramos lugares cercanos en este momento.');
      } else {
        await speak(
          `Encontramos ${nearby.length} lugares cercanos. El primero es ${nearby[0].name}, a ${formatDistance(nearby[0].distanceMeters)}.`,
        );
      }
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : 'No se pudieron cargar los lugares cercanos.';
      setError(message);
      await speak(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadPlaces();
    }, 0);

    return () => clearTimeout(timeout);
  }, [loadPlaces]);

  const startTrip = (place: NearbyPlace, travelMode: TravelMode) => {
    if (!location) return;
    setTripPlace(null);
    router.push({
      pathname: '/start-trip',
      params: {
        originLat: location.latitude.toString(),
        originLng: location.longitude.toString(),
        destName: place.name,
        destAddress: place.address,
        destLat: place.latitude.toString(),
        destLng: place.longitude.toString(),
        travelMode,
      },
    });
  };

  const renderPlace = ({ item }: { item: NearbyPlace }) => (
    <View style={styles.placeCard}>
      <Pressable
        accessibilityHint="Lee el nombre, la dirección y la distancia"
        accessibilityLabel={`${item.name}. ${item.address}. A ${formatDistance(item.distanceMeters)}.`}
        onPress={() =>
          void speak(
            `${item.name}. ${item.address}. Está a ${formatDistance(item.distanceMeters)}.`,
          )
        }
        style={styles.placeInformation}>
        <View style={styles.placeIcon}>
          <MaterialCommunityIcons
            color="#4DAA57"
            name={getCategoryIcon(item.category)}
            size={24}
          />
        </View>
        <View style={styles.placeText}>
          <Text numberOfLines={2} style={styles.placeName}>{item.name}</Text>
          <Text numberOfLines={2} style={styles.placeAddress}>{item.address}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.category}>{item.category}</Text>
            <Text style={styles.distance}>{formatDistance(item.distanceMeters)}</Text>
          </View>
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Ver ${item.name} en el mapa`}
          onPress={() =>
            router.push({
              pathname: '/map-explorer',
              params: {
                latitude: item.latitude.toString(),
                longitude: item.longitude.toString(),
                name: item.name,
                address: item.address,
              },
            } as unknown as Href)
          }
          style={styles.mapButton}>
          <MaterialCommunityIcons color="#B18CFF" name="map-outline" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel={`Elegir cómo ir hacia ${item.name}`}
          disabled={!location}
          onPress={() => setTripPlace(item)}
          style={styles.navigateButton}>
          <Ionicons color="#FFFFFF" name="navigate" size={18} />
          <Text style={styles.navigateButtonText}>Ir</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver a Explorar"
            onPress={() => router.back()}
            style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Lugares cercanos</Text>
            <Text style={styles.subtitle}>En un radio de 1,5 kilómetros</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="map-marker-radius-outline" size={21} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#4DAA57" size="large" />
            <Text style={styles.stateTitle}>Buscando lugares cerca tuyo…</Text>
          </View>
        ) : error ? (
          <View accessibilityRole="alert" style={styles.centerState}>
            <MaterialCommunityIcons color="#FF8D8D" name="map-marker-alert-outline" size={46} />
            <Text style={styles.errorTitle}>No pudimos buscar lugares</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityLabel="Reintentar búsqueda de lugares cercanos"
              onPress={() => void loadPlaces(true)}
              style={styles.retryButton}>
              <MaterialCommunityIcons color="#FFFFFF" name="refresh" size={20} />
              <Text style={styles.retryButtonText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={[
              styles.listContent,
              places.length === 0 ? styles.emptyListContent : null,
            ]}
            data={places}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <MaterialCommunityIcons color="#7F8A9B" name="map-marker-off-outline" size={46} />
                <Text style={styles.stateTitle}>No encontramos lugares cercanos</Text>
                <Text style={styles.stateDescription}>Deslizá hacia abajo para volver a buscar.</Text>
              </View>
            }
            refreshControl={
              <RefreshControl
                colors={['#4DAA57']}
                onRefresh={() => void loadPlaces(true)}
                refreshing={isRefreshing}
                tintColor="#4DAA57"
              />
            }
            renderItem={renderPlace}
            showsVerticalScrollIndicator={false}
          />
        )}
        <TravelModePicker
          onClose={() => setTripPlace(null)}
          onSelect={(mode) => {
            if (tripPlace) {
              startTrip(tripPlace, mode);
            }
          }}
          placeName={tripPlace?.name || ''}
          visible={Boolean(tripPlace)}
        />
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
    backgroundColor: 'rgba(77, 170, 87, 0.17)',
  },
  safeArea: {
    flex: 1,
    paddingTop: 8,
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0D141D',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: '#7F8A9B',
    fontSize: 11,
  },
  headerBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#4DAA57',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  placeCard: {
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 12,
    backgroundColor: '#0C1118',
    marginBottom: 10,
    padding: 12,
  },
  placeInformation: {
    flexDirection: 'row',
    gap: 11,
  },
  placeIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(77, 170, 87, 0.14)',
  },
  placeText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  placeName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  placeAddress: {
    color: '#8D98A9',
    fontSize: 11,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 3,
  },
  category: {
    flex: 1,
    color: '#6F7A8A',
    fontSize: 10,
    textTransform: 'capitalize',
  },
  distance: {
    color: '#4DAA57',
    fontSize: 12,
    fontWeight: '900',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#26303D',
    marginTop: 11,
    paddingTop: 10,
  },
  mapButton: {
    width: 46,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#493675',
    borderRadius: 8,
    backgroundColor: 'rgba(141, 91, 255, 0.1)',
  },
  navigateButton: {
    minWidth: 108,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: '#4DAA57',
    paddingHorizontal: 13,
  },
  navigateButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 26,
  },
  stateTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateDescription: {
    color: '#7F8A9B',
    fontSize: 13,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#FF9D9D',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorText: {
    color: '#AEB7C7',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    backgroundColor: '#4DAA57',
    paddingHorizontal: 22,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
