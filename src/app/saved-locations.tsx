import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchLocations } from '@/lib/location-search';
import { getSavedLocations, LocationItem, saveSavedLocations } from '@/lib/saved-locations';
import { speak } from '@/lib/voice';

export default function SavedLocationsScreen() {
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<LocationItem | null>(null);
  const [apiResults, setApiResults] = useState<LocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const data = await getSavedLocations();
      setLocations(data);
    }
    void load();
    void speak('Sección de mis ubicaciones guardadas.');
  }, []);

  // Debounced search logic
  useEffect(() => {
    if (searchQuery.trim().length < 3 || selectedAddress !== null) {
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsLoading(true);
      const results = await searchLocations(searchQuery);
      setApiResults(results as LocationItem[]);
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedAddress]);

  const handleDelete = async (id: string, name: string) => {
    try {
      const filtered = locations.filter((loc) => loc.id !== id);
      await saveSavedLocations(filtered);
      setLocations(filtered);
      void speak(`Ubicación ${name} eliminada.`);
    } catch (error) {
      console.error(error);
      void speak('Error al eliminar la ubicación.');
    }
  };

  const handleOpenAdd = () => {
    setNewName('');
    setSearchQuery('');
    setSelectedAddress(null);
    setApiResults([]);
    setIsAdding(true);
    void speak('Ingresa un nombre descriptivo y busca la dirección para la nueva ubicación.');
  };

  const handleSelectAddress = (item: LocationItem) => {
    setSelectedAddress(item);
    setSearchQuery(item.address);
    setApiResults([]);
    void speak(`Dirección seleccionada: ${item.address}.`);
  };

  const handleSaveLocation = async () => {
    if (newName.trim() === '') {
      void speak('Por favor escribe un nombre para esta ubicación.');
      return;
    }
    if (!selectedAddress) {
      void speak('Por favor busca y selecciona una dirección válida.');
      return;
    }

    try {
      const newLoc: LocationItem = {
        id: Date.now().toString(),
        name: newName.trim(),
        address: selectedAddress.address,
        latitude: selectedAddress.latitude,
        longitude: selectedAddress.longitude,
      };

      const updated = [...locations, newLoc];
      await saveSavedLocations(updated);
      setLocations(updated);
      setIsAdding(false);
      void speak(`Ubicación ${newLoc.name} guardada correctamente.`);
    } catch (error) {
      console.error(error);
      void speak('Error al guardar la ubicación.');
    }
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
            <Text style={styles.title}>Mis ubicaciones</Text>
          </View>
          <Pressable
            accessibilityLabel="Agregar nueva ubicación"
            onPress={handleOpenAdd}
            style={styles.headerAddBtn}
          >
            <Ionicons color="#FFFFFF" name="add" size={22} />
          </Pressable>
        </View>

        {!isAdding ? (
          <FlatList
            data={locations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardIconBg}>
                  <Ionicons color="#E9528A" name="star" size={20} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text numberOfLines={2} style={styles.cardAddress}>
                    {item.address}
                  </Text>
                </View>
                {/* Prevent deleting default locations 1-4 for convenience, but allow deleting others or all */}
                <Pressable
                  accessibilityLabel={`Eliminar ubicación ${item.name}`}
                  onPress={() => handleDelete(item.id, item.name)}
                  style={styles.deleteButton}
                >
                  <Ionicons color="#FF4E72" name="trash-outline" size={18} />
                </Pressable>
              </View>
            )}
            ListEmptyComponent={() => (
              <View style={styles.emptyWrapper}>
                <Ionicons color="#3A4350" name="bookmark-outline" size={48} />
                <Text style={styles.emptyText}>No tienes ubicaciones guardadas.</Text>
              </View>
            )}
          />
        ) : (
          /* Add Location Panel */
          <View style={styles.formContainer}>
            <Text style={styles.formLabel}>Nombre (Ej: Casa, Trabajo, Gimnasio)</Text>
            <TextInput
              placeholder="Escribe un nombre..."
              placeholderTextColor="#596474"
              value={newName}
              onChangeText={setNewName}
              style={styles.formInput}
            />

            <Text style={styles.formLabel}>Buscar dirección</Text>
            <View style={styles.searchContainer}>
              <TextInput
                placeholder="Escribe la dirección..."
                placeholderTextColor="#596474"
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  if (selectedAddress) {
                    setSelectedAddress(null);
                  }
                  if (text.trim().length < 3) {
                    setApiResults([]);
                  }
                }}
                style={styles.formInput}
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => {
                    setSearchQuery('');
                    setSelectedAddress(null);
                    setApiResults([]);
                  }}
                  style={styles.searchClearBtn}
                >
                  <Ionicons color="#7F8A9B" name="close-circle" size={18} />
                </Pressable>
              )}
            </View>

            {isLoading && (
              <View style={styles.loadingWrapper}>
                <ActivityIndicator size="small" color="#E9528A" />
                <Text style={styles.loadingText}>Buscando direcciones...</Text>
              </View>
            )}

            {apiResults.length > 0 && (
              <FlatList
                data={apiResults}
                keyExtractor={(item, index) => `${item.id}-${index}`}
                keyboardShouldPersistTaps="handled"
                style={styles.resultsList}
                renderItem={({ item }) => (
                  <Pressable onPress={() => handleSelectAddress(item)} style={styles.resultsItem}>
                    <Ionicons color="#7F8A9B" name="location-outline" size={16} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultsName}>{item.name}</Text>
                      <Text numberOfLines={1} style={styles.resultsAddress}>
                        {item.address}
                      </Text>
                    </View>
                  </Pressable>
                )}
              />
            )}

            <View style={styles.formActions}>
              <Pressable onPress={() => setIsAdding(false)} style={[styles.btn, styles.btnCancel]}>
                <Text style={styles.btnCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={handleSaveLocation} style={[styles.btn, styles.btnSave]}>
                <Text style={styles.btnSaveText}>Guardar ubicación</Text>
              </Pressable>
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
    backgroundColor: 'rgba(233, 82, 138, 0.12)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -180,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(177, 140, 255, 0.12)',
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
    color: '#E9528A',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  headerAddBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#E9528A',
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
    gap: 12,
  },
  cardIconBg: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(233, 82, 138, 0.14)',
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
  cardAddress: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 78, 114, 0.08)',
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
  // Form Styles
  formContainer: {
    flex: 1,
    gap: 10,
  },
  formLabel: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '950',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  formInput: {
    height: 48,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  searchContainer: {
    position: 'relative',
    justifyContent: 'center',
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
  resultsList: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderRadius: 8,
    backgroundColor: '#0C1118',
    marginTop: 4,
  },
  resultsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#121923',
  },
  resultsName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  resultsAddress: {
    color: '#7F8A9B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1D2633',
  },
  btnCancelText: {
    color: '#7F8A9B',
    fontSize: 14,
    fontWeight: '900',
  },
  btnSave: {
    backgroundColor: '#E9528A',
  },
  btnSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
