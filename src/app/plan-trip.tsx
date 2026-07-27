import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchLocations } from '@/lib/location-search';
import { getSavedLocations, LocationItem } from '@/lib/saved-locations';
import { addSavedJourney } from '@/lib/saved-journeys';
import { speak } from '@/lib/voice';

type TravelMode = 'transit' | 'driving' | 'walking';

const GPS_ORIGIN_NAME = 'Mi ubicación actual';
const GPS_ORIGIN_ADDRESS = 'Ubicación obtenida por GPS';

async function getLocationLabels(latitude: number, longitude: number) {
  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!address) return null;

    const streetAddress = [address.street, address.streetNumber].filter(Boolean).join(' ');
    const name =
      streetAddress ||
      address.name ||
      address.district ||
      address.city ||
      'Origen del viaje';
    const addressParts = [
      streetAddress,
      address.district,
      address.city,
      address.region,
      address.country,
    ].filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index);

    return {
      name,
      address: address.formattedAddress || addressParts.join(', ') || name,
    };
  } catch (error) {
    console.warn('No se pudo obtener la dirección del origen:', error);
    return null;
  }
}

const travelModes: {
  value: TravelMode;
  label: string;
  icon: 'bus' | 'car' | 'walk';
}[] = [
  { value: 'transit', label: 'Transporte', icon: 'bus' },
  { value: 'driving', label: 'Auto', icon: 'car' },
  { value: 'walking', label: 'A pie', icon: 'walk' },
];

export default function PlanTripScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const isSimulationMode = params.mode === 'simulate';
  const [gpsLocation, setGpsLocation] = useState<LocationItem | null>(null);
  const [origin, setOrigin] = useState<LocationItem | null>(null);
  const [destination, setDestination] = useState<LocationItem | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('walking');

  const [activeSearch, setActiveSearch] = useState<'origin' | 'destination' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [savedLocations, setSavedLocations] = useState<LocationItem[]>([]);
  const [apiResults, setApiResults] = useState<LocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [isSavingJourney, setIsSavingJourney] = useState(false);
  const [journeyTitle, setJourneyTitle] = useState('');

  // Load permissions, user coordinates, and saved locations
  useEffect(() => {
    async function initializeLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const locationData = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const currentItem: LocationItem = {
            id: 'current',
            name: GPS_ORIGIN_NAME,
            address: GPS_ORIGIN_ADDRESS,
            latitude: locationData.coords.latitude,
            longitude: locationData.coords.longitude,
          };
          setGpsLocation(currentItem);
          setOrigin(currentItem); // Default departure to current location

          const labels = await getLocationLabels(
            currentItem.latitude,
            currentItem.longitude,
          );
          if (labels) {
            const locatedItem = { ...currentItem, ...labels };
            setGpsLocation(locatedItem);
            setOrigin((selectedOrigin) =>
              selectedOrigin?.id === 'current' ? locatedItem : selectedOrigin,
            );
          }
        } else {
          void speak('Permiso de ubicación denegado. Deberás ingresar el origen de manera manual.');
        }
      } catch (error) {
        console.warn('Error al obtener la ubicación GPS:', error);
      }
    }

    async function loadSaved() {
      const locations = await getSavedLocations();
      setSavedLocations(locations);
    }

    void initializeLocation();
    void loadSaved();

    void speak(
      isSimulationMode
        ? 'Simulación de viaje. Seleccioná el origen y el destino exactos que querés simular.'
        : 'Planificación de viaje. Por defecto, el origen es tu ubicación actual. Selecciona destino para continuar.',
    );
  }, [isSimulationMode]);

  // Debounced search logic for Nominatim API
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsLoading(true);
      const results = await searchLocations(
        searchQuery,
        {
          userCoords: gpsLocation
            ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude }
            : undefined,
        },
      );
      setApiResults(results as LocationItem[]);
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, gpsLocation]);

  const handleOpenSearch = (type: 'origin' | 'destination') => {
    setActiveSearch(type);
    setSearchQuery('');
    setApiResults([]);
    void speak(`Buscando ${type === 'origin' ? 'origen' : 'destino'}. Escribe para ver sugerencias.`);
  };

  const handleSelectLocation = (location: LocationItem) => {
    if (activeSearch === 'origin') {
      setOrigin(location);
      void speak(`Origen seleccionado: ${location.address}.`);
    } else if (activeSearch === 'destination') {
      setDestination(location);
      void speak(`Destino seleccionado: ${location.address}.`);
    }
    setActiveSearch(null);
  };

  const handleClearLocation = (type: 'origin' | 'destination') => {
    if (type === 'origin') {
      setOrigin(null);
    } else {
      setDestination(null);
    }
  };

  const handleStartTrip = () => {
    if (!origin || !destination) return;
    router.push({
      pathname: '/start-trip',
      params: {
        originName: origin.name,
        originAddress: origin.address,
        originLat: origin.latitude.toString(),
        originLng: origin.longitude.toString(),
        destName: destination.name,
        destAddress: destination.address,
        destLat: destination.latitude.toString(),
        destLng: destination.longitude.toString(),
        travelMode,
        mode: isSimulationMode ? 'simulate' : 'start',
        autoStartSimulation: isSimulationMode ? '1' : '0',
      },
    });
  };

  const handleSelectTravelMode = (mode: TravelMode, label: string) => {
    setTravelMode(mode);
    void speak(`Modo de viaje: ${label}.`);
  };

  const handleOpenSaveJourney = () => {
    if (!origin || !destination) return;
    setJourneyTitle(`De ${origin.name} a ${destination.name}`);
    setIsSavingJourney(true);
    void speak('Escribe un nombre para guardar este viaje.');
  };

  const handleConfirmSaveJourney = async () => {
    if (!origin || !destination) return;
    if (journeyTitle.trim() === '') {
      void speak('El nombre del viaje no puede estar vacío.');
      return;
    }
    try {
      let fixedOrigin = { ...origin };
      if (origin.id === 'current') {
        let latitude = origin.latitude;
        let longitude = origin.longitude;

        try {
          const currentPosition = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          latitude = currentPosition.coords.latitude;
          longitude = currentPosition.coords.longitude;
        } catch (error) {
          console.warn('Se guardará la última posición GPS disponible:', error);
        }

        const labels = await getLocationLabels(latitude, longitude);

        fixedOrigin = {
          ...origin,
          id: `journey-origin-${Date.now()}`,
          name: labels?.name || 'Origen del viaje',
          address:
            labels?.address ||
            `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
          latitude,
          longitude,
        };
      }

      const originalDefaultTitle = `De ${origin.name} a ${destination.name}`;
      const savedTitle =
        journeyTitle.trim() === originalDefaultTitle
          ? `De ${fixedOrigin.name} a ${destination.name}`
          : journeyTitle.trim();

      await addSavedJourney(
        fixedOrigin,
        { ...destination },
        savedTitle,
        travelMode,
      );
      setIsSavingJourney(false);
      void speak(`Viaje guardado correctamente como: ${savedTitle}.`);
    } catch (error) {
      console.error(error);
      void speak('Ocurrió un error al guardar el viaje.');
    }
  };

  // Filter saved locations based on search query
  const filteredSaved = savedLocations.filter(
    (loc) =>
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.address.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <SafeAreaView style={styles.safeArea}>
        {/* Main Planning Screen */}
        {activeSearch === null ? (
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="Volver a sección de viajes"
                onPress={() => router.replace('/travel')}
                style={styles.backButton}
              >
                <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
              </Pressable>
              <View style={styles.headerText}>
                <Text style={styles.title}>{isSimulationMode ? 'Simular viaje' : 'Planificar viaje'}</Text>
              </View>
              <View style={styles.headerBadge}>
                <MaterialCommunityIcons color="#FFFFFF" name="map-marker-distance" size={21} />
              </View>
            </View>

            <View style={styles.content}>
              <View style={styles.inputsWrapper}>
                {/* Origin Field */}
                <Text style={styles.fieldLabel}>Punto de partida (Origen)</Text>
                <View style={styles.inputContainer}>
                  <Pressable
                    accessibilityLabel={
                      origin ? `Origen: ${origin.name}. Presiona para cambiar.` : 'Establecer punto de partida'
                    }
                    onPress={() => handleOpenSearch('origin')}
                    style={styles.inputPressable}
                  >
                    <Ionicons color="#208AEF" name="pin-outline" size={20} />
                    <View style={styles.inputTextWrapper}>
                      <Text numberOfLines={1} style={origin ? styles.inputText : styles.inputPlaceholder}>
                        {origin ? origin.name : 'Seleccionar origen...'}
                      </Text>
                      {origin && (
                        <Text numberOfLines={1} style={styles.inputSubtext}>
                          {origin.address}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  {origin && (
                    <Pressable
                      accessibilityLabel="Quitar origen"
                      onPress={() => handleClearLocation('origin')}
                      style={styles.clearButton}
                    >
                      <Ionicons color="#7F8A9B" name="close-circle" size={20} />
                    </Pressable>
                  )}
                </View>

                {/* Destination Field */}
                <Text style={styles.fieldLabel}>Destino (Llegada)</Text>
                <View style={styles.inputContainer}>
                  <Pressable
                    accessibilityLabel={
                      destination ? `Destino: ${destination.name}. Presiona para cambiar.` : 'Establecer destino'
                    }
                    onPress={() => handleOpenSearch('destination')}
                    style={styles.inputPressable}
                  >
                    <Ionicons color="#8D5BFF" name="flag-outline" size={20} />
                    <View style={styles.inputTextWrapper}>
                      <Text numberOfLines={1} style={destination ? styles.inputText : styles.inputPlaceholder}>
                        {destination ? destination.name : 'Escribe tu destino...'}
                      </Text>
                      {destination && (
                        <Text numberOfLines={1} style={styles.inputSubtext}>
                          {destination.address}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  {destination && (
                    <Pressable
                      accessibilityLabel="Quitar destino"
                      onPress={() => handleClearLocation('destination')}
                      style={styles.clearButton}
                    >
                      <Ionicons color="#7F8A9B" name="close-circle" size={20} />
                    </Pressable>
                  )}
                </View>

                <Text style={styles.fieldLabel}>Cómo querés viajar</Text>
                <View accessibilityRole="radiogroup" style={styles.travelModeRow}>
                  {travelModes.map((mode) => {
                    const isSelected = travelMode === mode.value;
                    return (
                      <Pressable
                        accessibilityLabel={`Viajar en ${mode.label}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isSelected }}
                        key={mode.value}
                        onPress={() => handleSelectTravelMode(mode.value, mode.label)}
                        style={[styles.travelModeButton, isSelected && styles.travelModeButtonSelected]}
                      >
                        <Ionicons
                          color={isSelected ? '#FFFFFF' : '#7F8A9B'}
                          name={mode.icon}
                          size={21}
                        />
                        <Text style={[styles.travelModeText, isSelected && styles.travelModeTextSelected]}>
                          {mode.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionButtonsRow}>
                <Pressable
                  accessibilityLabel="Guardar este viaje en favoritos"
                  disabled={!origin || !destination}
                  onPress={handleOpenSaveJourney}
                  style={[styles.actionButton, styles.saveButton, (!origin || !destination) && styles.actionButtonDisabled]}
                >
                  <Ionicons color="#FFFFFF" name="star-outline" size={18} />
                  <Text style={styles.actionButtonText}>Guardar viaje</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel={
                    isSimulationMode ? 'Simular el viaje seleccionado' : 'Iniciar navegación de viaje planificado'
                  }
                  disabled={!origin || !destination}
                  onPress={handleStartTrip}
                  style={[styles.actionButton, styles.startButton, (!origin || !destination) && styles.actionButtonDisabled]}
                >
                  <MaterialCommunityIcons color="#FFFFFF" name="navigation-variant" size={18} />
                  <Text style={styles.actionButtonText}>
                    {isSimulationMode ? 'Simular viaje' : 'Iniciar viaje'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          /* Autocomplete Overlay Screen */
          <View style={{ flex: 1 }}>
            <View style={styles.searchHeader}>
              <Pressable
                accessibilityLabel="Cancelar búsqueda"
                onPress={() => setActiveSearch(null)}
                style={styles.backButton}
              >
                <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
              </Pressable>
              <TextInput
                autoFocus
                placeholder={activeSearch === 'origin' ? 'Buscar origen...' : 'Buscar destino...'}
                placeholderTextColor="#596474"
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  if (text.trim().length < 3) {
                    setApiResults([]);
                  }
                }}
                style={styles.searchInput}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => {
                    setSearchQuery('');
                    setApiResults([]);
                  }}
                  style={styles.searchClearBtn}
                >
                  <Ionicons color="#D9DEEA" name="close-circle" size={20} />
                </Pressable>
              )}
            </View>

            {isLoading && (
              <View style={styles.loadingWrapper}>
                <ActivityIndicator size="small" color="#208AEF" />
                <Text style={styles.loadingText}>Buscando ubicaciones...</Text>
              </View>
            )}

            <FlatList
              data={[
                // Inject current location option if searching origin and GPS is ready
                ...(activeSearch === 'origin' && gpsLocation && searchQuery.trim() === '' ? [gpsLocation] : []),
                // Saved Locations
                ...filteredSaved.map((item) => ({ ...item, isSaved: true })),
                // API Results
                ...apiResults.map((item) => ({ ...item, isSaved: false })),
              ]}
              keyExtractor={(item, index) => `${item.id}-${index}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContainer}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityLabel={`${item.name}. ${item.address}`}
                  onPress={() => handleSelectLocation(item)}
                  style={styles.listItem}
                >
                  <View
                    style={[
                      styles.listItemIcon,
                      item.id === 'current'
                        ? styles.gpsIconBg
                        : item.isSaved
                          ? styles.savedIconBg
                          : styles.apiIconBg,
                    ]}
                  >
                    {item.id === 'current' ? (
                      <Ionicons color="#208AEF" name="locate" size={18} />
                    ) : item.isSaved ? (
                      <Ionicons color="#B18CFF" name="star" size={18} />
                    ) : (
                      <Ionicons color="#7F8A9B" name="map-marker-outline" size={18} />
                    )}
                  </View>
                  <View style={styles.listItemTextWrapper}>
                    <Text numberOfLines={1} style={styles.listItemName}>
                      {item.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.listItemAddress}>
                      {item.address}
                    </Text>
                  </View>
                  <Ionicons color="#596474" name="chevron-forward" size={16} />
                </Pressable>
              )}
              ListHeaderComponent={() => (
                <Text style={styles.listHeaderTitle}>
                  {searchQuery.trim() === '' ? 'Ubicaciones Guardadas' : 'Resultados de búsqueda'}
                </Text>
              )}
              ListEmptyComponent={() => (
                <View style={styles.emptyWrapper}>
                  <Text style={styles.emptyText}>
                    {searchQuery.trim().length < 3
                      ? 'Escribe al menos 3 letras para buscar...'
                      : 'No se encontraron resultados.'}
                  </Text>
                </View>
              )}
            />
          </View>
        )}

        {/* Save Journey Dialog Modal Overlay */}
        {isSavingJourney && (
          <Modal
            animationType="fade"
            navigationBarTranslucent
            onRequestClose={() => setIsSavingJourney(false)}
            statusBarTranslucent
            transparent
            visible
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalOverlay}
            >
              <ScrollView
                contentContainerStyle={styles.modalKeyboardContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Guardar viaje</Text>
                  <Text style={styles.modalInputLabel}>Nombre del recorrido</Text>
                  <TextInput
                    accessibilityLabel="Nombre del recorrido"
                    autoFocus
                    placeholder="Ejemplo: Viaje al trabajo"
                    placeholderTextColor="#596474"
                    returnKeyType="done"
                    value={journeyTitle}
                    onChangeText={setJourneyTitle}
                    onSubmitEditing={() => void handleConfirmSaveJourney()}
                    style={styles.modalInput}
                  />
                  <View style={styles.modalButtons}>
                    <Pressable onPress={() => setIsSavingJourney(false)} style={[styles.modalBtn, styles.modalBtnCancel]}>
                      <Text style={styles.modalBtnCancelText}>Cancelar</Text>
                    </Pressable>
                    <Pressable onPress={handleConfirmSaveJourney} style={[styles.modalBtn, styles.modalBtnConfirm]}>
                      <Text style={styles.modalBtnConfirmText}>Guardar</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </Modal>
        )}
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
    marginBottom: 16,
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
  subtitle: {
    color: '#208AEF',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
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
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  inputsWrapper: {
    gap: 12,
  },
  fieldLabel: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '950',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 12,
  },
  inputPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inputTextWrapper: {
    flex: 1,
  },
  inputText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  inputPlaceholder: {
    color: '#596474',
    fontSize: 14,
    fontWeight: '800',
  },
  inputSubtext: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  travelModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  travelModeButton: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
  },
  travelModeButtonSelected: {
    borderColor: '#208AEF',
    backgroundColor: '#145B9B',
  },
  travelModeText: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '900',
  },
  travelModeTextSelected: {
    color: '#FFFFFF',
  },
  clearButton: {
    padding: 4,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 25,
    elevation: 2,
  },
  saveButton: {
    backgroundColor: '#6A29FF',
    borderWidth: 1,
    borderColor: '#7F4DFF',
  },
  startButton: {
    backgroundColor: '#208AEF',
  },
  actionButtonDisabled: {
    backgroundColor: '#161D26',
    borderColor: '#1D2633',
    opacity: 0.5,
    elevation: 0,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 11, 0.85)',
  },
  modalKeyboardContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#0C1118',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '950',
    marginBottom: 8,
  },
  modalDescription: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#05070B',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 20,
  },
  modalInputLabel: {
    color: '#D6DCE5',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    minWidth: 90,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalBtnCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1D2633',
  },
  modalBtnCancelText: {
    color: '#7F8A9B',
    fontSize: 13,
    fontWeight: '900',
  },
  modalBtnConfirm: {
    backgroundColor: '#6A29FF',
  },
  modalBtnConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  // Search Overlay Styles
  searchHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  searchClearBtn: {
    position: 'absolute',
    right: 12,
    padding: 6,
  },
  loadingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  loadingText: {
    color: '#7F8A9B',
    fontSize: 12,
    fontWeight: '700',
  },
  listContainer: {
    paddingBottom: 24,
  },
  listHeaderTitle: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '950',
    textTransform: 'uppercase',
    marginVertical: 10,
    paddingHorizontal: 4,
  },
  listItem: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#121923',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  listItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsIconBg: {
    backgroundColor: 'rgba(32, 138, 239, 0.14)',
  },
  savedIconBg: {
    backgroundColor: 'rgba(177, 140, 255, 0.14)',
  },
  apiIconBg: {
    backgroundColor: 'rgba(58, 67, 80, 0.2)',
  },
  listItemTextWrapper: {
    flex: 1,
  },
  listItemName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  listItemAddress: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  emptyWrapper: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#596474',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});
