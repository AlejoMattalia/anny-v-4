import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ExplorerMap from '@/components/explorer-map';
import {
  ExplorerMapMarker,
  MapCoordinate,
} from '@/components/explorer-map.types';
import TravelModePicker, {
  TravelMode,
} from '@/components/travel-mode-picker';
import { getCurrentLocation } from '@/lib/current-location';
import {
  LocationSearchResult,
  searchLocations,
} from '@/lib/location-search';
import { getSavedLocations } from '@/lib/saved-locations';
import { speak } from '@/lib/voice';

const FALLBACK_LOCATION = {
  latitude: -31.4201,
  longitude: -64.1888,
};

export default function MapExplorerScreen() {
  const params = useLocalSearchParams<{
    latitude?: string;
    longitude?: string;
    name?: string;
    address?: string;
  }>();
  const hasInitialTarget =
    Number.isFinite(Number(params.latitude)) &&
    Number.isFinite(Number(params.longitude));
  const initialLocation = useMemo<MapCoordinate>(() => {
    const latitude = Number(params.latitude);
    const longitude = Number(params.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : FALLBACK_LOCATION;
  }, [params.latitude, params.longitude]);

  const [userLocation, setUserLocation] =
    useState<MapCoordinate>(initialLocation);
  const [markers, setMarkers] = useState<ExplorerMapMarker[]>([]);
  const [selectedPlace, setSelectedPlace] =
    useState<LocationSearchResult | null>(null);
  const [focusLocation, setFocusLocation] =
    useState<MapCoordinate>(initialLocation);
  const [focusKey, setFocusKey] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [isLocating, setIsLocating] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [showTravelModes, setShowTravelModes] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const savedLocations = await getSavedLocations();
      if (active) {
        const savedMarkers = savedLocations.map((location) => ({
          id: `saved-${location.id}`,
          title: location.name,
          description: location.address,
          latitude: location.latitude,
          longitude: location.longitude,
          kind: 'saved',
        }) satisfies ExplorerMapMarker);
        const targetMarker: ExplorerMapMarker[] =
          hasInitialTarget && params.name
            ? [
                {
                  id: 'initial-target',
                  title: params.name,
                  description: params.address,
                  latitude: initialLocation.latitude,
                  longitude: initialLocation.longitude,
                  kind: 'search',
                },
              ]
            : [];
        setMarkers([...savedMarkers, ...targetMarker]);
        if (targetMarker[0]) {
          setSelectedPlace({
            id: targetMarker[0].id,
            name: targetMarker[0].title,
            address: targetMarker[0].description || '',
            latitude: targetMarker[0].latitude,
            longitude: targetMarker[0].longitude,
          });
        }
      }

      try {
        const current = await getCurrentLocation();
        if (!active) return;
        const coordinates = {
          latitude: current.latitude,
          longitude: current.longitude,
        };
        setUserLocation(coordinates);
        if (!hasInitialTarget) {
          setFocusLocation(coordinates);
          setFocusKey((key) => key + 1);
        }
      } catch (error) {
        if (!active) return;
        setLocationError(
          error instanceof Error
            ? error.message
            : 'No se pudo obtener tu ubicación.',
        );
      } finally {
        if (active) {
          setIsLocating(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [
    hasInitialTarget,
    initialLocation.latitude,
    initialLocation.longitude,
    params.address,
    params.name,
  ]);

  useEffect(() => {
    if (query.trim().length < 3) {
      return;
    }

    let active = true;
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      const found = await searchLocations(query, {
        userCoords: userLocation,
        limit: 6,
      });
      if (active) {
        setResults(found);
        setIsSearching(false);
      }
    }, 450);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, userLocation]);

  const focusMap = (coordinate: MapCoordinate) => {
    setFocusLocation(coordinate);
    setFocusKey((key) => key + 1);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < 3) {
      setResults([]);
      setIsSearching(false);
    }
  };

  const selectSearchResult = (result: LocationSearchResult) => {
    const marker: ExplorerMapMarker = {
      id: `search-${result.id}`,
      title: result.name,
      description: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
      kind: 'search',
    };
    setMarkers((current) => [
      ...current.filter((item) => item.kind !== 'search'),
      marker,
    ]);
    setSelectedPlace(result);
    setQuery(result.name);
    setResults([]);
    Keyboard.dismiss();
    focusMap(result);
    void speak(`${result.name}. ${result.address}`);
  };

  const startTripToSelectedPlace = (travelMode: TravelMode) => {
    if (!selectedPlace) return;
    setShowTravelModes(false);
    const originParams = locationError
      ? {}
      : {
          originLat: userLocation.latitude.toString(),
          originLng: userLocation.longitude.toString(),
        };
    router.push({
      pathname: '/start-trip',
      params: {
        ...originParams,
        destName: selectedPlace.name,
        destAddress: selectedPlace.address,
        destLat: selectedPlace.latitude.toString(),
        destLng: selectedPlace.longitude.toString(),
        travelMode,
      },
    });
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver a Explorar"
            onPress={() => router.back()}
            style={styles.backButton}>
            <Ionicons color="#3C1642" name="chevron-back" size={24} />
          </Pressable>
          <Text style={styles.title}>Explorador de mapa</Text>
          {isLocating ? (
            <ActivityIndicator color="#6A0DAD" size="small" />
          ) : (
            <View style={styles.headerBadge}>
              <MaterialCommunityIcons color="#FFFFFF" name="map-search-outline" size={21} />
            </View>
          )}
        </View>

        <View style={styles.searchShell}>
          <Ionicons color="#6A0DAD" name="search" size={20} />
          <TextInput
            accessibilityLabel="Buscar un lugar en el mapa"
            autoCorrect={false}
            onChangeText={handleQueryChange}
            placeholder="Buscar un lugar…"
            placeholderTextColor="#707989"
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {isSearching ? <ActivityIndicator color="#6A0DAD" size="small" /> : null}
          {query ? (
            <Pressable
              accessibilityLabel="Limpiar búsqueda"
              onPress={() => {
                setQuery('');
                setResults([]);
                setSelectedPlace(null);
              }}>
              <Ionicons color="#6F5873" name="close-circle" size={20} />
            </Pressable>
          ) : null}
        </View>

        {results.length > 0 ? (
          <FlatList
            data={results}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`${item.name}. ${item.address}`}
                onPress={() => selectSearchResult(item)}
                style={styles.resultRow}>
                <MaterialCommunityIcons color="#6A0DAD" name="map-marker-outline" size={20} />
                <View style={styles.resultText}>
                  <Text numberOfLines={1} style={styles.resultName}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.resultAddress}>{item.address}</Text>
                </View>
              </Pressable>
            )}
            style={styles.resultsList}
          />
        ) : null}

        {locationError ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{locationError}</Text>
          </View>
        ) : null}

        <View style={styles.mapContainer}>
          <ExplorerMap
            focusKey={focusKey}
            focusLocation={focusLocation}
            markers={markers}
            onMarkerPress={(marker) => {
              focusMap(marker);
              setSelectedPlace({
                id: marker.id,
                name: marker.title,
                address: marker.description || '',
                latitude: marker.latitude,
                longitude: marker.longitude,
              });
              void speak(`${marker.title}. ${marker.description || ''}`);
            }}
            userLocation={userLocation}
          />

          <Pressable
            accessibilityLabel="Centrar mapa en mi ubicación"
            onPress={() => focusMap(userLocation)}
            style={styles.recenterButton}>
            <MaterialCommunityIcons color="#FFFFFF" name="crosshairs-gps" size={23} />
          </Pressable>

          {selectedPlace ? (
            <View style={styles.selectedCard}>
              <View style={styles.selectedText}>
                <Text numberOfLines={1} style={styles.selectedName}>{selectedPlace.name}</Text>
                <Text numberOfLines={1} style={styles.selectedAddress}>{selectedPlace.address}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Elegir cómo ir hacia ${selectedPlace.name}`}
                onPress={() => setShowTravelModes(true)}
                style={styles.startButton}>
                <Ionicons color="#FFFFFF" name="navigate" size={19} />
                <Text style={styles.startButtonText}>Ir</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <TravelModePicker
          onClose={() => setShowTravelModes(false)}
          onSelect={startTripToSelectedPlace}
          placeName={selectedPlace?.name || ''}
          visible={showTravelModes && Boolean(selectedPlace)}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FCFCFC',
  },
  safeArea: {
    flex: 1,
    paddingTop: 8,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DED5E0',
    borderRadius: 8,
    backgroundColor: '#F2EDF3',
  },
  title: {
    flex: 1,
    color: '#3C1642',
    fontSize: 18,
    fontWeight: '900',
  },
  headerBadge: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#6A0DAD',
  },
  searchShell: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#283445',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#3C1642',
    fontSize: 14,
    paddingVertical: 11,
  },
  resultsList: {
    position: 'absolute',
    zIndex: 20,
    top: 122,
    right: 14,
    left: 14,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: '#283445',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  resultRow: {
    minHeight: 61,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#283445',
    paddingHorizontal: 12,
  },
  resultText: {
    flex: 1,
    gap: 3,
  },
  resultName: {
    color: '#3C1642',
    fontSize: 13,
    fontWeight: '900',
  },
  resultAddress: {
    color: '#6F5873',
    fontSize: 11,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: '#67383E',
    backgroundColor: '#211014',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  errorText: {
    color: '#FFB3B3',
    fontSize: 12,
    textAlign: 'center',
  },
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: '#DED5E0',
  },
  recenterButton: {
    position: 'absolute',
    right: 14,
    bottom: 106,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#6A0DAD',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 5,
  },
  selectedCard: {
    position: 'absolute',
    right: 12,
    bottom: 14,
    left: 12,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#352A55',
    borderRadius: 12,
    backgroundColor: '#F2EDF3',
    padding: 12,
  },
  selectedText: {
    flex: 1,
    gap: 4,
  },
  selectedName: {
    color: '#3C1642',
    fontSize: 14,
    fontWeight: '900',
  },
  selectedAddress: {
    color: '#8D98A9',
    fontSize: 11,
  },
  startButton: {
    minWidth: 62,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 9,
    backgroundColor: '#4DAA57',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
