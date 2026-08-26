import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cancelBluetoothDiscovery,
  connectBluetoothDevice,
  type AnnyBluetoothDevice,
  disconnectBluetoothDevice,
  discoverBluetoothDevices,
  getBluetoothErrorMessage,
  getBluetoothState,
  getPairedBluetoothDevices,
  openBluetoothSettings,
  pairBluetoothDevice,
  requestBluetoothEnabled,
  requestBluetoothPermissions,
  subscribeToBluetoothChanges,
} from '@/lib/bluetooth-glasses';
import { connectGlassesToNearbySavedNetwork } from '@/lib/automatic-glasses-network';
import { speak } from '@/lib/voice';

function mergeDevices(
  current: AnnyBluetoothDevice[],
  incoming: AnnyBluetoothDevice[],
) {
  const devices = new Map(current.map((device) => [device.id, device]));
  incoming.forEach((device) => {
    devices.set(device.id, { ...devices.get(device.id), ...device });
  });

  return Array.from(devices.values()).sort((first, second) => {
    if (first.isGlasses !== second.isGlasses) {
      return first.isGlasses ? -1 : 1;
    }
    if (first.connected !== second.connected) {
      return first.connected ? -1 : 1;
    }
    return first.name.localeCompare(second.name);
  });
}

export default function BluetoothDevicesScreen() {
  const [supported, setSupported] = useState(Platform.OS === 'android');
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [devices, setDevices] = useState<AnnyBluetoothDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState('');
  const [error, setError] = useState('');

  const glasses = useMemo(
    () => devices.filter((device) => device.isGlasses),
    [devices],
  );
  const otherDevices = useMemo(
    () => devices.filter((device) => !device.isGlasses && device.bonded),
    [devices],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const state = await getBluetoothState();
      setSupported(state.supported);
      setBluetoothEnabled(state.enabled);

      if (!state.supported || !state.enabled) {
        setDevices([]);
        return;
      }

      const pairedDevices = await getPairedBluetoothDevices();
      setDevices((current) => mergeDevices(current, pairedDevices));
      setError('');
    } catch (refreshError) {
      setError(getBluetoothErrorMessage(refreshError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function initialize() {
        setIsLoading(true);
        const permission = await requestBluetoothPermissions();

        if (!active) return;
        setPermissionDenied(permission === 'denied');
        if (permission === 'denied') {
          setIsLoading(false);
          setError(
            'Anny necesita permiso para buscar y conectar los lentes por Bluetooth.',
          );
          await speak(
            'Permiso de Bluetooth denegado. Podés activarlo desde los ajustes de la aplicación.',
          );
          return;
        }

        await refreshDevices();
      }

      void initialize();
      const removeBluetoothListeners = subscribeToBluetoothChanges(() => {
        if (active) {
          void refreshDevices();
        }
      });

      return () => {
        active = false;
        removeBluetoothListeners();
        void cancelBluetoothDiscovery();
      };
    }, [refreshDevices]),
  );

  async function activateBluetooth() {
    try {
      setIsLoading(true);
      const enabled = await requestBluetoothEnabled();
      setBluetoothEnabled(enabled);
      if (enabled) {
        await speak('Bluetooth activado.');
        await refreshDevices();
      }
    } catch (activationError) {
      const message = getBluetoothErrorMessage(activationError);
      setError(message);
      await speak(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function scanForGlasses() {
    try {
      setError('');
      setIsScanning(true);
      await speak(
        'Buscando lentes Anny. Mantené los lentes encendidos y cerca del teléfono.',
      );
      const discovered = await discoverBluetoothDevices();
      const discoveredGlasses = discovered.filter(
        (device) => device.isGlasses,
      );
      setDevices((current) => mergeDevices(current, discovered));

      if (discoveredGlasses.length === 0) {
        await speak(
          'No encontré lentes Anny. Verificá que estén encendidos y en modo de vinculación.',
        );
      } else {
        await speak(
          `Encontré ${discoveredGlasses.length} ${
            discoveredGlasses.length === 1 ? 'lente Anny' : 'lentes Anny'
          }.`,
        );
      }
    } catch (scanError) {
      const message = getBluetoothErrorMessage(scanError);
      setError(message);
      await speak(message);
    } finally {
      setIsScanning(false);
    }
  }

  async function connect(device: AnnyBluetoothDevice) {
    try {
      setBusyDeviceId(device.id);
      setError('');
      await speak(`Conectando con ${device.isGlasses ? 'Lentes Anny' : device.name}.`);
      const connected = await connectBluetoothDevice(device);
      setDevices((current) => mergeDevices(current, [connected]));
      try {
        const networkResult = await connectGlassesToNearbySavedNetwork(connected);
        await speak(
          networkResult.status === 'connected'
            ? `Lentes Anny conectados a ${networkResult.network.ssid}.`
            : 'Lentes Anny conectados por Bluetooth. No encontré una red guardada cercana.',
        );
      } catch (networkError) {
        console.warn('[AnnyWiFi] Falló la conexión automática a una red guardada', networkError);
        await speak('Lentes Anny conectados por Bluetooth. No pude buscar las redes WiFi cercanas.');
      }
    } catch (connectionError) {
      const message = getBluetoothErrorMessage(connectionError);
      setError(message);
      await speak(message);
      await refreshDevices();
    } finally {
      setBusyDeviceId('');
    }
  }

  async function pairAndConnect(device: AnnyBluetoothDevice) {
    try {
      setBusyDeviceId(device.id);
      setError('');
      await speak('Vinculando Lentes Anny.');
      const paired = await pairBluetoothDevice(device.id);
      const nextDevice = { ...paired, bonded: true };
      setDevices((current) => mergeDevices(current, [nextDevice]));
      await connect(nextDevice);
    } catch (pairError) {
      const message = getBluetoothErrorMessage(pairError);
      setError(message);
      await speak(message);
    } finally {
      setBusyDeviceId('');
    }
  }

  async function disconnect(device: AnnyBluetoothDevice) {
    try {
      setBusyDeviceId(device.id);
      await disconnectBluetoothDevice(device.id);
      setDevices((current) =>
        current.map((item) =>
          item.id === device.id ? { ...item, connected: false } : item,
        ),
      );
      await speak('Lentes Anny desconectados.');
    } catch (disconnectError) {
      const message = getBluetoothErrorMessage(disconnectError);
      setError(message);
      await speak(message);
    } finally {
      setBusyDeviceId('');
    }
  }

  function renderDevice(device: AnnyBluetoothDevice) {
    const busy = busyDeviceId === device.id;
    const status = device.connected
      ? 'Conectado'
      : device.bonded
        ? 'Vinculado'
        : 'Detectado';

    return (
      <View
        accessibilityLabel={`${device.isGlasses ? 'Lentes Anny' : device.name}. ${status}`}
        key={device.id}
        style={[styles.deviceCard, device.connected ? styles.deviceCardConnected : null]}
      >
        <View
          style={[
            styles.deviceIcon,
            device.isGlasses ? styles.glassesIcon : null,
          ]}
        >
          <MaterialCommunityIcons
            color={device.isGlasses ? '#B18CFF' : '#7F8A9B'}
            name={device.isGlasses ? 'glasses' : 'bluetooth'}
            size={27}
          />
        </View>

        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>
            {device.isGlasses ? 'Lentes Anny' : device.name}
          </Text>
          {device.isGlasses ? (
            <Text style={styles.deviceTechnicalName}>{device.name}</Text>
          ) : null}
          <View style={styles.deviceStatusRow}>
            <View
              style={[
                styles.deviceStatusDot,
                device.connected
                  ? styles.connectedDot
                  : styles.disconnectedDot,
              ]}
            />
            <Text style={styles.deviceStatus}>{status}</Text>
          </View>
          <Text style={styles.deviceAddress}>{device.address}</Text>
        </View>

        {busy ? (
          <ActivityIndicator color="#B18CFF" />
        ) : device.isGlasses ? (
          <View style={styles.deviceActions}>
            {device.connected ? (
              <Pressable
                accessibilityLabel="Abrir lente"
                accessibilityRole="button"
                onPress={() => router.push('/glasses-network')}
                style={styles.deviceAction}
              >
                <Text style={styles.deviceActionText}>Abrir lente</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel={device.bonded ? 'Conectar Lentes Anny' : 'Vincular Lentes Anny'}
                accessibilityRole="button"
                onPress={() => {
                  if (device.bonded) {
                    void connect(device);
                  } else {
                    void pairAndConnect(device);
                  }
                }}
                style={styles.deviceAction}
              >
                <Text style={styles.deviceActionText}>{device.bonded ? 'Conectar' : 'Vincular'}</Text>
              </Pressable>
            )}
            {device.connected ? (
              <Pressable
                accessibilityLabel="Desconectar Lentes Anny"
                accessibilityRole="button"
                onPress={() => void disconnect(device)}
                style={[styles.deviceAction, styles.disconnectAction]}
              >
                <MaterialCommunityIcons color="#FFADB4" name="bluetooth-off" size={18} />
                <Text style={[styles.deviceActionText, styles.disconnectActionText]}>
                  Desconectar
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <MaterialCommunityIcons
            color="#596474"
            name="chevron-right"
            size={22}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topGlow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Dispositivos</Text>
            <Text style={styles.subtitle}>Conexión de Lentes Anny</Text>
          </View>
          <View style={styles.headerBadge}>
            <MaterialCommunityIcons
              color="#FFFFFF"
              name="bluetooth"
              size={23}
            />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {Platform.OS !== 'android' || !supported ? (
            <View style={styles.infoPanel}>
              <MaterialCommunityIcons
                color="#7F8A9B"
                name="bluetooth-off"
                size={42}
              />
              <Text style={styles.infoTitle}>Bluetooth Classic no disponible</Text>
              <Text style={styles.infoText}>
                La conexión serial de los lentes está disponible en Android.
              </Text>
            </View>
          ) : permissionDenied ? (
            <View style={styles.infoPanel}>
              <MaterialCommunityIcons
                color="#E5A93D"
                name="shield-alert-outline"
                size={42}
              />
              <Text style={styles.infoTitle}>Falta permiso de Bluetooth</Text>
              <Text style={styles.infoText}>
                Activá Dispositivos cercanos en los permisos de Anny.
              </Text>
              <Pressable
                accessibilityLabel="Abrir permisos de Anny"
                onPress={() => void Linking.openSettings()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Abrir permisos</Text>
              </Pressable>
            </View>
          ) : !bluetoothEnabled ? (
            <View style={styles.infoPanel}>
              <MaterialCommunityIcons
                color="#B18CFF"
                name="bluetooth-off"
                size={42}
              />
              <Text style={styles.infoTitle}>Bluetooth está desactivado</Text>
              <Text style={styles.infoText}>
                Activá Bluetooth para buscar y conectar los lentes.
              </Text>
              <Pressable
                accessibilityLabel="Activar Bluetooth"
                onPress={() => void activateBluetooth()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Activar Bluetooth</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.statusPanel}>
                <View style={styles.statusIcon}>
                  <MaterialCommunityIcons
                    color="#4DAA57"
                    name="bluetooth-connect"
                    size={24}
                  />
                </View>
                <View style={styles.statusText}>
                  <Text style={styles.statusTitle}>Bluetooth activado</Text>
                  <Text style={styles.statusDescription}>
                    {glasses.some((device) => device.connected)
                      ? 'Lentes Anny conectados'
                      : 'Todavía no hay lentes conectados'}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  accessibilityLabel="Buscar Lentes Anny"
                  disabled={isScanning}
                  onPress={() => void scanForGlasses()}
                  style={[
                    styles.primaryButton,
                    styles.flexButton,
                    isScanning ? styles.disabledButton : null,
                  ]}
                >
                  {isScanning ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <MaterialCommunityIcons
                      color="#FFFFFF"
                      name="radar"
                      size={19}
                    />
                  )}
                  <Text style={styles.primaryButtonText}>
                    {isScanning ? 'Buscando…' : 'Buscar lentes'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Abrir ajustes Bluetooth"
                  onPress={openBluetoothSettings}
                  style={styles.iconButton}
                >
                  <MaterialCommunityIcons
                    color="#B18CFF"
                    name="cog-outline"
                    size={22}
                  />
                </Pressable>
              </View>

              {error ? (
                <View accessibilityRole="alert" style={styles.errorPanel}>
                  <MaterialCommunityIcons
                    color="#FF7A85"
                    name="alert-circle-outline"
                    size={21}
                  />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {isLoading ? (
                <View style={styles.loadingPanel}>
                  <ActivityIndicator color="#B18CFF" />
                  <Text style={styles.loadingText}>Revisando dispositivos…</Text>
                </View>
              ) : (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Lentes Anny</Text>
                    {glasses.length > 0 ? (
                      glasses.map(renderDevice)
                    ) : (
                      <View style={styles.emptyPanel}>
                        <MaterialCommunityIcons
                          color="#596474"
                          name="glasses"
                          size={32}
                        />
                        <Text style={styles.emptyTitle}>
                          No hay lentes detectados
                        </Text>
                        <Text style={styles.emptyText}>
                          Encendé los lentes y tocá Buscar lentes. Si todavía no
                          aparecen, vinculalos desde los ajustes Bluetooth.
                        </Text>
                      </View>
                    )}
                  </View>

                  {otherDevices.length > 0 ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        Otros dispositivos vinculados
                      </Text>
                      {otherDevices.map(renderDevice)}
                      <Text style={styles.sectionHint}>
                        Estos dispositivos se administran desde los ajustes del
                        teléfono.
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}
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
    backgroundColor: 'rgba(141, 91, 255, 0.2)',
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
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: '#7F8A9B',
    fontSize: 11,
    marginTop: 2,
  },
  headerBadge: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#6A29FF',
  },
  content: {
    paddingTop: 14,
    paddingBottom: 34,
    gap: 14,
  },
  infoPanel: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0C1118',
    padding: 24,
  },
  infoTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  infoText: {
    color: '#AEB7C7',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  statusPanel: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#204D36',
    backgroundColor: 'rgba(77, 170, 87, 0.1)',
    paddingHorizontal: 14,
  },
  statusIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: 'rgba(77, 170, 87, 0.16)',
  },
  statusText: {
    flex: 1,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  statusDescription: {
    color: '#9BBDA7',
    fontSize: 12,
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    backgroundColor: '#6A29FF',
    paddingHorizontal: 18,
  },
  flexButton: {
    flex: 1,
  },
  disabledButton: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  iconButton: {
    width: 48,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#293548',
    backgroundColor: '#101720',
  },
  errorPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#63313A',
    backgroundColor: 'rgba(255, 70, 85, 0.08)',
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: '#FFADB4',
    fontSize: 12,
    lineHeight: 18,
  },
  loadingPanel: {
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#AEB7C7',
    fontSize: 12,
  },
  section: {
    gap: 9,
  },
  sectionTitle: {
    color: '#AEB7C7',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  deviceCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1D2633',
    backgroundColor: '#0C1118',
    padding: 12,
  },
  deviceCardConnected: {
    borderColor: '#315C43',
  },
  deviceIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    backgroundColor: '#151C26',
  },
  glassesIcon: {
    backgroundColor: 'rgba(141, 91, 255, 0.14)',
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  deviceTechnicalName: {
    color: '#7F8A9B',
    fontSize: 11,
    marginTop: 2,
  },
  deviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  deviceStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  connectedDot: {
    backgroundColor: '#4DAA57',
  },
  disconnectedDot: {
    backgroundColor: '#7F8A9B',
  },
  deviceStatus: {
    color: '#AEB7C7',
    fontSize: 11,
    fontWeight: '800',
  },
  deviceAddress: {
    color: '#596474',
    fontSize: 10,
    marginTop: 3,
  },
  deviceAction: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#6A29FF',
    paddingHorizontal: 12,
  },
  deviceActions: {
    alignItems: 'stretch',
    gap: 6,
  },
  disconnectAction: {
    backgroundColor: '#3A2430',
  },
  disconnectActionText: {
    color: '#FFADB4',
  },
  deviceActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  emptyPanel: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1D2633',
    borderStyle: 'dashed',
    padding: 20,
  },
  emptyTitle: {
    color: '#D9DEEA',
    fontSize: 14,
    fontWeight: '900',
  },
  emptyText: {
    color: '#7F8A9B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  sectionHint: {
    color: '#596474',
    fontSize: 11,
    lineHeight: 17,
  },
});
