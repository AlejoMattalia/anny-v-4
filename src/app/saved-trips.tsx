import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteSavedJourney, getSavedJourneys, SavedJourney } from '@/lib/saved-journeys';
import { speak } from '@/lib/voice';

export default function SavedTripsScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [journeys, setJourneys] = useState<SavedJourney[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<SavedJourney | null>(null);
  const isSimulationMode = params.mode === 'simulate';

  const loadJourneys = useCallback(async () => {
    const data = await getSavedJourneys();
    setJourneys(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadJourneys();
    }, [loadJourneys])
  );

  useEffect(() => {
    void speak('Pantalla de viajes guardados y favoritos.');
  }, []);

  const handleDelete = async (id: string, title: string) => {
    try {
      const updated = await deleteSavedJourney(id);
      setJourneys(updated);
      void speak(`Viaje ${title} eliminado.`);
      if (selectedJourney?.id === id) {
        setSelectedJourney(null);
      }
    } catch (error) {
      console.error(error);
      void speak('Error al eliminar el viaje.');
    }
  };

  const handleSelectJourney = (journey: SavedJourney) => {
    setSelectedJourney(journey);
    void speak(
      `Seleccionaste ${journey.title}. Origen: ${journey.origin.name}. Destino: ${journey.destination.name}. ¿Deseas ${isSimulationMode ? 'simular' : 'iniciar'} este viaje?`,
    );
  };

  const handleOpenSelectedTrip = () => {
    if (!selectedJourney) return;
    router.push({
      pathname: '/start-trip',
      params: {
        originName: selectedJourney.origin.name,
        originAddress: selectedJourney.origin.address,
        originLat: selectedJourney.origin.latitude.toString(),
        originLng: selectedJourney.origin.longitude.toString(),
        destName: selectedJourney.destination.name,
        destAddress: selectedJourney.destination.address,
        destLat: selectedJourney.destination.latitude.toString(),
        destLng: selectedJourney.destination.longitude.toString(),
        travelMode: selectedJourney.travelMode ?? 'walking',
        mode: isSimulationMode ? 'simulate' : 'start',
        autoStartSimulation: isSimulationMode ? '1' : '0',
      },
    });
    setSelectedJourney(null);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver a sección de viajes"
            onPress={() => router.replace('/travel')}
            style={styles.backButton}
          >
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Viajes guardados</Text>
            <Text style={styles.subtitle}>
              {isSimulationMode ? 'Elegí uno para simular' : 'Elegí uno para iniciar'}
            </Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons color="#FFFFFF" name="folder-heart" size={21} />
          </View>
        </View>

        <FlatList
          data={journeys}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                accessibilityLabel={`Viaje favorito: ${item.title}`}
                onPress={() => handleSelectJourney(item)}
                style={styles.cardPressable}
              >
                <View style={styles.cardIconBg}>
                  <MaterialCommunityIcons color="#B18CFF" name="routes" size={22} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <View style={styles.cardStep}>
                    <Ionicons color="#208AEF" name="pin-outline" size={12} />
                    <Text numberOfLines={1} style={styles.cardStepText}>
                      Origen: {item.origin.name}
                    </Text>
                  </View>
                  <View style={styles.cardStep}>
                    <Ionicons color="#8D5BFF" name="flag-outline" size={12} />
                    <Text numberOfLines={1} style={styles.cardStepText}>
                      Destino: {item.destination.name}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel="Eliminar viaje de favoritos"
                onPress={() => handleDelete(item.id, item.title)}
                style={styles.deleteButton}
              >
                <Ionicons color="#FF4E72" name="trash-outline" size={18} />
              </Pressable>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyWrapper}>
              <MaterialCommunityIcons color="#3A4350" name="map-marker-off" size={48} />
              <Text style={styles.emptyText}>No tienes viajes guardados todavía.</Text>
              <Text style={styles.emptySubtext}>
                Guarda un viaje desde planificar viaje y después podrás {isSimulationMode ? 'simularlo' : 'iniciarlo'} desde aquí.
              </Text>
              <Pressable
                accessibilityLabel="Ir a planificar viaje"
                onPress={() =>
                  router.push({
                    pathname: '/plan-trip',
                    params: isSimulationMode ? { mode: 'simulate' } : {},
                  })
                }
                style={styles.emptyActionBtn}
              >
                <Text style={styles.emptyActionText}>Planificar viaje</Text>
              </Pressable>
            </View>
          )}
        />

        {/* Selected Journey Modal Detail */}
        {selectedJourney && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{selectedJourney.title}</Text>
              <Text style={styles.modalLabel}>Detalles de la ruta</Text>

              <View style={styles.modalDetailRow}>
                <Ionicons color="#208AEF" name="pin-outline" size={18} />
                <View style={styles.modalDetailText}>
                  <Text style={styles.modalDetailLabel}>Origen</Text>
                  <Text style={styles.modalDetailValue}>{selectedJourney.origin.name}</Text>
                  <Text style={styles.modalDetailAddress}>{selectedJourney.origin.address}</Text>
                </View>
              </View>

              <View style={styles.modalDetailRow}>
                <Ionicons color="#8D5BFF" name="flag-outline" size={18} />
                <View style={styles.modalDetailText}>
                  <Text style={styles.modalDetailLabel}>Destino</Text>
                  <Text style={styles.modalDetailValue}>{selectedJourney.destination.name}</Text>
                  <Text style={styles.modalDetailAddress}>{selectedJourney.destination.address}</Text>
                </View>
              </View>

              <View style={styles.modalButtons}>
                <Pressable onPress={() => setSelectedJourney(null)} style={[styles.modalBtn, styles.modalBtnCancel]}>
                  <Text style={styles.modalBtnCancelText}>Cerrar</Text>
                </Pressable>
                <Pressable onPress={handleOpenSelectedTrip} style={[styles.modalBtn, styles.modalBtnConfirm]}>
                  <Text style={styles.modalBtnConfirmText}>
                    {isSimulationMode ? 'Simular viaje' : 'Iniciar viaje'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
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
    backgroundColor: 'rgba(177, 140, 255, 0.12)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(32, 138, 239, 0.12)',
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
    color: '#B18CFF',
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
    backgroundColor: '#B18CFF',
  },
  listContainer: {
    paddingBottom: 20,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    padding: 12,
  },
  cardPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIconBg: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(177, 140, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  cardStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardStepText: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 78, 114, 0.08)',
    marginLeft: 8,
  },
  emptyWrapper: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 16,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#596474',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 24,
  },
  emptyActionBtn: {
    marginTop: 18,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#B18CFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActionText: {
    color: '#05070B',
    fontSize: 13,
    fontWeight: '900',
  },
  // Modal detail
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 11, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 999,
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
    marginBottom: 4,
  },
  modalLabel: {
    color: '#B18CFF',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  modalDetailRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  modalDetailText: {
    flex: 1,
  },
  modalDetailLabel: {
    color: '#7F8A9B',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  modalDetailValue: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  modalDetailAddress: {
    color: '#596474',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
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
    backgroundColor: '#B18CFF',
  },
  modalBtnConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
