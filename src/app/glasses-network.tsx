import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  connectGlassesToNetwork,
  getBluetoothErrorMessage,
  getConnectedAnnyGlasses,
  type AnnyBluetoothDevice,
} from '@/lib/bluetooth-glasses';
import {
  clearActiveGlassesNetwork,
  deleteGlassesNetwork,
  getActiveGlassesNetwork,
  getSavedGlassesNetworks,
  type GlassesNetworkType,
  saveGlassesNetwork,
  setActiveGlassesNetwork,
  type SavedGlassesNetwork,
} from '@/lib/glasses-networks';
import { speak } from '@/lib/voice';
import { scanAvailableWifiNetworks } from '@/lib/wifi-scanner';

export default function GlassesNetworkScreen() {
  const [glasses, setGlasses] = useState<AnnyBluetoothDevice | null>(null);
  const [networkType, setNetworkType] = useState<GlassesNetworkType | null>(null);
  const [networks, setNetworks] = useState<SavedGlassesNetwork[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [connectingNetworkId, setConnectingNetworkId] = useState('');
  const [message, setMessage] = useState('');
  const [connectedSsid, setConnectedSsid] = useState('');
  const [detectedSsids, setDetectedSsids] = useState<string[]>([]);
  const [isScanningWifi, setIsScanningWifi] = useState(false);

  const visibleNetworks = useMemo(
    () => networks.filter((network) => network.type === networkType),
    [networkType, networks],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    const [connectedGlasses, savedNetworks, activeNetwork] = await Promise.all([
      getConnectedAnnyGlasses(),
      getSavedGlassesNetworks(),
      getActiveGlassesNetwork(),
    ]);
    setGlasses(connectedGlasses);
    setNetworks(savedNetworks);
    setConnectedSsid(
      connectedGlasses && activeNetwork?.deviceId === connectedGlasses.id
        ? activeNetwork.ssid
        : '',
    );
    setIsLoading(false);

    if (!connectedGlasses) {
      setMessage('Los lentes ya no están conectados por Bluetooth.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function chooseNetworkType(type: GlassesNetworkType) {
    setNetworkType(type);
    setIsAdding(false);
    setMessage('');
    void speak(`${type === 'hotspot' ? 'Hotspot' : 'WiFi'}. Elegí una red guardada o agregá una nueva.`);
    void scanNetworks();
  }

  async function scanNetworks() {
    try {
      setIsScanningWifi(true);
      setDetectedSsids([]);
      setMessage('');
      await speak('Buscando redes WiFi cercanas.');
      const availableSsids = await scanAvailableWifiNetworks();
      setDetectedSsids(availableSsids);
      if (availableSsids.length === 0) {
        await speak('No se encontraron redes WiFi cercanas. Podés escribir el nombre manualmente.');
      } else {
        await speak(`Se encontraron ${availableSsids.length} redes WiFi.`);
      }
    } catch (scanError) {
      const nextMessage = scanError instanceof Error ? scanError.message : 'No se pudieron buscar redes WiFi.';
      setMessage(nextMessage);
      await speak(nextMessage);
    } finally {
      setIsScanningWifi(false);
    }
  }

  function selectDetectedSsid(selectedSsid: string) {
    setSsid(selectedSsid);
    setPassword('');
    setIsAdding(true);
    setMessage('');
    void speak(`Red ${selectedSsid} seleccionada. Ingresá la contraseña.`);
  }

  function goBack() {
    if (isAdding) {
      setIsAdding(false);
      setSsid('');
      setPassword('');
      return;
    }
    if (networkType) {
      setNetworkType(null);
      setMessage('');
      return;
    }
    router.back();
  }

  async function connectNetwork(network: SavedGlassesNetwork) {
    const currentGlasses = await getConnectedAnnyGlasses();
    if (!currentGlasses) {
      const nextMessage = 'Conectá primero los lentes por Bluetooth.';
      setGlasses(null);
      setMessage(nextMessage);
      await speak(nextMessage);
      return;
    }

    try {
      setGlasses(currentGlasses);
      setConnectingNetworkId(network.id);
      setMessage('');
      await speak(`Conectando los lentes a ${network.ssid}.`);
      const connected = await connectGlassesToNetwork(
        currentGlasses.id,
        network.ssid,
        network.password,
      );

      if (!connected) {
        await clearActiveGlassesNetwork();
        setConnectedSsid('');
        throw new Error('Los lentes no confirmaron la conexión a la red. Revisá el nombre, la contraseña y que la red esté disponible.');
      }

      await setActiveGlassesNetwork(currentGlasses.id, network);
      setConnectedSsid(network.ssid);
      const nextMessage = `Lentes conectados a ${network.ssid}.`;
      setMessage(nextMessage);
      await speak(nextMessage);
    } catch (connectionError) {
      await clearActiveGlassesNetwork();
      setConnectedSsid('');
      const nextMessage = getBluetoothErrorMessage(connectionError);
      setMessage(nextMessage);
      await speak(nextMessage);
    } finally {
      setConnectingNetworkId('');
    }
  }

  async function saveAndConnect() {
    if (!networkType) return;
    const normalizedSsid = ssid.trim();
    if (!normalizedSsid || !password) {
      const nextMessage = 'Ingresá el nombre y la contraseña de la red.';
      setMessage(nextMessage);
      await speak(nextMessage);
      return;
    }

    const network = await saveGlassesNetwork(normalizedSsid, password, networkType);
    setNetworks(await getSavedGlassesNetworks());
    setIsAdding(false);
    setSsid('');
    setPassword('');
    await connectNetwork(network);
  }

  function confirmDelete(network: SavedGlassesNetwork) {
    Alert.alert('Eliminar red', `¿Querés eliminar “${network.ssid}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteGlassesNetwork(network.id);
            setNetworks(await getSavedGlassesNetworks());
            if (connectedSsid === network.ssid) {
              await clearActiveGlassesNetwork();
              setConnectedSsid('');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver" onPress={goBack} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Lentes Anny</Text>
            <Text style={styles.subtitle}>{glasses ? 'Bluetooth conectado' : 'Sin conexión Bluetooth'}</Text>
          </View>
          <View style={[styles.headerBadge, glasses ? styles.headerBadgeConnected : null]}>
            <MaterialCommunityIcons color="#FFFFFF" name={glasses ? 'check' : 'bluetooth-off'} size={22} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {isLoading ? (
            <View style={styles.loadingPanel}>
              <ActivityIndicator color="#B18CFF" />
              <Text style={styles.mutedText}>Revisando los lentes…</Text>
            </View>
          ) : !glasses ? (
            <View style={styles.emptyPanel}>
              <MaterialCommunityIcons color="#FF7A85" name="bluetooth-off" size={42} />
              <Text style={styles.emptyTitle}>Conectá primero los lentes</Text>
              <Text style={styles.emptyText}>Volvé a Dispositivos y completá el paso 1 mediante Bluetooth.</Text>
              <Pressable onPress={() => router.replace('/bluetooth-devices')} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Ir a Dispositivos</Text>
              </Pressable>
            </View>
          ) : !networkType ? (
            <>
              <View style={styles.stepPanel}>
                <Text style={styles.stepLabel}>PASO 2</Text>
                <Text style={styles.stepTitle}>Conectar los lentes a internet</Text>
                <Text style={styles.stepText}>Elegí Hotspot o WiFi. En ambos casos la configuración se envía al lente mediante Bluetooth.</Text>
              </View>
              <NetworkTypeButton
                description="Usar los datos compartidos de un celular"
                icon="access-point"
                label="Hotspot"
                onPress={() => chooseNetworkType('hotspot')}
              />
              <NetworkTypeButton
                description="Usar una red inalámbrica cercana"
                icon="wifi"
                label="WiFi"
                onPress={() => chooseNetworkType('wifi')}
              />
              <View style={styles.savedOverview}>
                <Text style={styles.networkTitle}>WiFi y Hotspots guardados</Text>
                <Text style={styles.savedOverviewText}>Elegí una red para conectar los lentes directamente.</Text>
                {networks.length ? networks.map((network) => (
                  <View key={network.id} style={[styles.networkCard, connectedSsid === network.ssid ? styles.networkCardConnected : null]}>
                    <MaterialCommunityIcons color="#B18CFF" name={network.type === 'hotspot' ? 'access-point' : 'wifi'} size={25} />
                    <View style={styles.networkInfo}>
                      <Text numberOfLines={1} style={styles.networkName}>{network.ssid}</Text>
                      <Text style={styles.networkStatus}>{network.type === 'hotspot' ? 'Hotspot guardado' : 'WiFi guardado'}</Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`Conectar lentes a ${network.ssid}`}
                      disabled={Boolean(connectingNetworkId) || connectedSsid === network.ssid}
                      onPress={() => void connectNetwork(network)}
                      style={[styles.connectButton, connectedSsid === network.ssid ? styles.connectedButton : null]}
                    >
                      {connectingNetworkId === network.id ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                        <Text style={styles.connectButtonText}>{connectedSsid === network.ssid ? 'Conectado' : 'Conectar'}</Text>
                      )}
                    </Pressable>
                  </View>
                )) : (
                  <Text style={styles.noWifiText}>Todavía no hay redes guardadas. Entrá en Hotspot o WiFi para agregar una.</Text>
                )}
              </View>
            </>
          ) : isAdding ? (
            <View style={styles.formPanel}>
              <Text style={styles.formTitle}>Agregar {networkType === 'hotspot' ? 'Hotspot' : 'WiFi'}</Text>
              <WifiScanPanel
                detectedSsids={detectedSsids}
                isScanning={isScanningWifi}
                onRefresh={() => void scanNetworks()}
                onSelect={selectDetectedSsid}
                selectedSsid={ssid}
              />
              <Text style={styles.fieldLabel}>Nombre de la red</Text>
              <TextInput
                accessibilityLabel="Nombre de la red"
                autoCapitalize="none"
                onChangeText={setSsid}
                placeholder="Ingresá el nombre"
                placeholderTextColor="#596474"
                style={styles.input}
                value={ssid}
              />
              <Text style={styles.fieldLabel}>Contraseña</Text>
              <TextInput
                accessibilityLabel="Contraseña de la red"
                autoCapitalize="none"
                onChangeText={setPassword}
                onSubmitEditing={() => void saveAndConnect()}
                placeholder="Ingresá la contraseña"
                placeholderTextColor="#596474"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <Pressable onPress={() => void saveAndConnect()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Guardar y conectar lentes</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.networkHeader}>
                <View>
                  <Text style={styles.stepLabel}>{networkType === 'hotspot' ? 'HOTSPOT' : 'WIFI'}</Text>
                  <Text style={styles.networkTitle}>Redes guardadas</Text>
                </View>
                <Pressable accessibilityLabel="Agregar red" onPress={() => setIsAdding(true)} style={styles.addButton}>
                  <MaterialCommunityIcons color="#FFFFFF" name="plus" size={20} />
                  <Text style={styles.addButtonText}>Agregar</Text>
                </Pressable>
              </View>

              <WifiScanPanel
                detectedSsids={detectedSsids}
                isScanning={isScanningWifi}
                onRefresh={() => void scanNetworks()}
                onSelect={selectDetectedSsid}
                selectedSsid={ssid}
              />

              {visibleNetworks.length ? visibleNetworks.map((network) => (
                <View key={network.id} style={[styles.networkCard, connectedSsid === network.ssid ? styles.networkCardConnected : null]}>
                  <MaterialCommunityIcons color="#B18CFF" name={network.type === 'hotspot' ? 'access-point' : 'wifi'} size={25} />
                  <View style={styles.networkInfo}>
                    <Text numberOfLines={1} style={styles.networkName}>{network.ssid}</Text>
                    <Text style={styles.networkStatus}>{connectedSsid === network.ssid ? 'Conectado' : 'Disponible para conectar'}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Conectar lentes a ${network.ssid}`}
                    disabled={Boolean(connectingNetworkId) || connectedSsid === network.ssid}
                    onPress={() => void connectNetwork(network)}
                    style={[styles.connectButton, connectedSsid === network.ssid ? styles.connectedButton : null]}
                  >
                    {connectingNetworkId === network.id ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                      <Text style={styles.connectButtonText}>{connectedSsid === network.ssid ? 'Conectado' : 'Conectar'}</Text>
                    )}
                  </Pressable>
                  <Pressable accessibilityLabel={`Eliminar ${network.ssid}`} onPress={() => confirmDelete(network)} style={styles.deleteButton}>
                    <MaterialCommunityIcons color="#FF7A85" name="delete-outline" size={20} />
                  </Pressable>
                </View>
              )) : (
                <View style={styles.noNetworksPanel}>
                  <Text style={styles.emptyTitle}>No hay redes guardadas</Text>
                  <Text style={styles.emptyText}>Agregá los datos de la red para conectar los lentes.</Text>
                </View>
              )}
            </>
          )}

          {message ? (
            <View accessibilityRole="alert" style={styles.messagePanel}>
              <MaterialCommunityIcons color={connectedSsid ? '#4DAA57' : '#E5A93D'} name={connectedSsid ? 'check-circle-outline' : 'information-outline'} size={21} />
              <Text style={styles.messageText}>{message}</Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function WifiScanPanel({
  detectedSsids,
  isScanning,
  onRefresh,
  onSelect,
  selectedSsid,
}: {
  detectedSsids: string[];
  isScanning: boolean;
  onRefresh: () => void;
  onSelect: (ssid: string) => void;
  selectedSsid: string;
}) {
  return (
    <View style={styles.scanPanel}>
      <View style={styles.scanHeader}>
        <View style={styles.scanTitleRow}>
          <MaterialCommunityIcons color="#B18CFF" name="wifi" size={21} />
          <Text style={styles.scanTitle}>{isScanning ? 'Buscando redes WiFi…' : 'Redes WiFi cercanas'}</Text>
        </View>
        <Pressable accessibilityLabel="Buscar redes WiFi de nuevo" disabled={isScanning} onPress={onRefresh} style={styles.refreshButton}>
          {isScanning ? <ActivityIndicator color="#B18CFF" size="small" /> : <MaterialCommunityIcons color="#B18CFF" name="refresh" size={21} />}
        </Pressable>
      </View>
      {isScanning ? (
        <View style={styles.scanningRow}>
          <ActivityIndicator color="#B18CFF" size="small" />
          <Text style={styles.scanningText}>Buscando WiFi para completar el nombre…</Text>
        </View>
      ) : detectedSsids.length ? (
        <View style={styles.ssidList}>
          {detectedSsids.map((detectedSsid) => (
            <Pressable
              accessibilityLabel={`Seleccionar red ${detectedSsid}`}
              key={detectedSsid}
              onPress={() => onSelect(detectedSsid)}
              style={[styles.ssidButton, selectedSsid === detectedSsid ? styles.ssidButtonSelected : null]}
            >
              <MaterialCommunityIcons color={selectedSsid === detectedSsid ? '#FFFFFF' : '#B18CFF'} name="wifi" size={17} />
              <Text numberOfLines={1} style={[styles.ssidText, selectedSsid === detectedSsid ? styles.ssidTextSelected : null]}>{detectedSsid}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.noWifiText}>No se encontraron redes. Podés escribir el nombre manualmente.</Text>
      )}
    </View>
  );
}

function NetworkTypeButton({
  description,
  icon,
  label,
  onPress,
}: {
  description: string;
  icon: 'access-point' | 'wifi';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={`Conectar lentes mediante ${label}`} onPress={onPress} style={styles.typeButton}>
      <View style={styles.typeIcon}><MaterialCommunityIcons color="#B18CFF" name={icon} size={30} /></View>
      <View style={styles.typeText}>
        <Text style={styles.typeTitle}>{label}</Text>
        <Text style={styles.typeDescription}>{description}</Text>
      </View>
      <MaterialCommunityIcons color="#7F8A9B" name="chevron-right" size={26} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070B' },
  topGlow: { position: 'absolute', top: -160, right: -130, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(141, 91, 255, 0.2)' },
  safeArea: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0D141D' },
  headerText: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#7F8A9B', fontSize: 11, marginTop: 2 },
  headerBadge: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#63313A' },
  headerBadgeConnected: { backgroundColor: '#315C43' },
  content: { paddingTop: 14, paddingBottom: 34, gap: 12 },
  loadingPanel: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 },
  mutedText: { color: '#AEB7C7', fontSize: 12 },
  emptyPanel: { minHeight: 270, alignItems: 'center', justifyContent: 'center', gap: 11, borderRadius: 14, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0C1118', padding: 24 },
  emptyTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: '#8F99AA', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  stepPanel: { borderRadius: 14, borderWidth: 1, borderColor: '#33235C', backgroundColor: 'rgba(106, 41, 255, 0.1)', padding: 18 },
  stepLabel: { color: '#B18CFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  stepTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', marginTop: 5 },
  stepText: { color: '#AEB7C7', fontSize: 13, lineHeight: 20, marginTop: 7 },
  typeButton: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0C1118', padding: 14 },
  typeIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: 'rgba(141, 91, 255, 0.14)' },
  typeText: { flex: 1 },
  typeTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  typeDescription: { color: '#8F99AA', fontSize: 12, lineHeight: 17, marginTop: 3 },
  networkHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  networkTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', marginTop: 3 },
  addButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: '#6A29FF', paddingHorizontal: 12 },
  addButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  formPanel: { gap: 9, borderRadius: 14, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0C1118', padding: 16 },
  formTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', marginBottom: 5 },
  fieldLabel: { color: '#AEB7C7', fontSize: 12, fontWeight: '800', marginTop: 5 },
  input: { minHeight: 48, borderRadius: 9, borderWidth: 1, borderColor: '#293548', backgroundColor: '#101720', color: '#FFFFFF', paddingHorizontal: 13 },
  primaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#6A29FF', paddingHorizontal: 18, marginTop: 7 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  networkCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0C1118', padding: 11 },
  networkCardConnected: { borderColor: '#315C43' },
  networkInfo: { flex: 1, minWidth: 0 },
  networkName: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  networkStatus: { color: '#7F8A9B', fontSize: 10, marginTop: 4 },
  connectButton: { minHeight: 36, minWidth: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#6A29FF', paddingHorizontal: 9 },
  connectedButton: { backgroundColor: '#315C43' },
  connectButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  deleteButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  noNetworksPanel: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#293548', padding: 20 },
  messagePanel: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 10, borderWidth: 1, borderColor: '#4A4128', backgroundColor: 'rgba(229, 169, 61, 0.08)', padding: 12 },
  messageText: { flex: 1, color: '#D9DEEA', fontSize: 12, lineHeight: 18 },
  scanPanel: { gap: 10, borderRadius: 11, borderWidth: 1, borderColor: '#293548', backgroundColor: '#101720', padding: 12 },
  scanHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scanTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanTitle: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  refreshButton: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(141, 91, 255, 0.1)' },
  scanningRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  scanningText: { color: '#AEB7C7', fontSize: 12 },
  ssidList: { gap: 7 },
  ssidButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 8, borderWidth: 1, borderColor: '#293548', backgroundColor: '#0C1118', paddingHorizontal: 11 },
  ssidButtonSelected: { borderColor: '#6A29FF', backgroundColor: '#6A29FF' },
  ssidText: { flex: 1, color: '#D9DEEA', fontSize: 12, fontWeight: '800' },
  ssidTextSelected: { color: '#FFFFFF' },
  noWifiText: { color: '#7F8A9B', fontSize: 11, lineHeight: 17 },
  savedOverview: { gap: 9, borderRadius: 13, borderWidth: 1, borderColor: '#1D2633', backgroundColor: '#0C1118', padding: 13, marginTop: 2 },
  savedOverviewText: { color: '#7F8A9B', fontSize: 11, lineHeight: 17, marginBottom: 2 },
});
