import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useWifiLensConnection } from './useWifiLensConnection';
import { useAssistance } from './assistance-context';
import SavedNetworksService from '../services/SavedNetworksService';
import { migrateWifiLens } from '../services/migrateWifiLens';
import type { LensPairing, LensStatus } from '../services/LocalWifiLens';
import type { WifiLensConnection, WifiLensConnectionManager } from '../services/WifiLensConnectionManager';
import type { NetworkType, SavedNetwork } from '../types/savedNetwork';

type LensContext = {
  wifiLensConnection: WifiLensConnection;
  manager: WifiLensConnectionManager;
  networks: SavedNetwork[];
  networkPreference: NetworkType;
  setNetworkPreference: (type: NetworkType) => Promise<void>;
  connect: (network: SavedNetwork) => Promise<boolean>;
  disconnect: () => Promise<void>;
  trackWifiLensCamera: (pair: LensPairing, status: LensStatus) => Promise<() => void>;
};
export const WifiLensContext = createContext<LensContext>(null!);
export const useWifiLens = () => useContext(WifiLensContext);

export function WifiLensProvider({ children }: PropsWithChildren) {
  const { role, authLoaded } = useAssistance();
  const [initialized, setInitialized] = useState(false);
  const [preference, setPreference] = useState<NetworkType>('wifi');
  const [networks, setNetworks] = useState<SavedNetwork[]>([]);
  // Keep the exact v3 owner for startup, roaming, foregrounding and explicit handoffs.
  const enabled = initialized && authLoaded && role !== 'TUTOR';
  const { connection, manager } = useWifiLensConnection(enabled, preference, enabled);
  useEffect(() => {
    let active = true;
    async function reload() {
      const saved = await SavedNetworksService.getAll();
      if (active) setNetworks(saved);
    }
    void (async () => {
      // Restore before enabling startup polling or opening any camera.
      const disconnected = await SavedNetworksService.getDisconnected().catch(() => true);
      if (!active) return;
      manager.restoreDisconnected(disconnected);
      if (!disconnected) {
        try { await migrateWifiLens(); }
        catch { console.warn('[WifiLens] Vinculación anterior pendiente de migrar.'); }
      }
      const mode = await SavedNetworksService.getPreference();
      await reload();
      if (active) { setPreference(mode); setInitialized(true); }
    })();
    const unsubscribe = SavedNetworksService.subscribe(() => void reload());
    return () => { active = false; unsubscribe(); };
  }, [manager]);
  const setNetworkPreference = useCallback(async (type: NetworkType) => {
    await SavedNetworksService.setPreference(type);
    setPreference(type);
    await manager.switchNetworkType(type);
  }, [manager]);
  const connect = useCallback(async (network: SavedNetwork) => {
    await SavedNetworksService.setPreference(network.type);
    setPreference(network.type);
    return manager.connect(network);
  }, [manager]);
  const trackWifiLensCamera = useCallback((pair: LensPairing, status: LensStatus) => manager.trackCamera(pair, status), [manager]);
  const disconnect = useCallback(() => manager.disconnect(), [manager]);
  const connectionFailed = connection.phase === 'disconnected';
  const closeDialog = () => connectionFailed ? manager.dismissDialog() : void manager.refreshStatus();
  return <WifiLensContext.Provider value={{ wifiLensConnection: connection, manager, networks, networkPreference: preference, setNetworkPreference, connect, disconnect, trackWifiLensCamera }}>
    {children}
    <Modal visible={connection.showDialog && ['searching', 'connecting', 'disconnected'].includes(connection.phase)} transparent animationType="fade" onRequestClose={closeDialog}>
      <View style={styles.overlay}><View style={styles.dialog}>
        {!connectionFailed ? <ActivityIndicator color="#6A0DAD" size="large" /> : null}
        <Text accessibilityLiveRegion="polite" style={styles.message}>{connection.message}</Text>
        {connectionFailed ? <>
          <Pressable accessibilityRole="button" onPress={() => void manager.refresh(true, true)}><Text style={styles.cancel}>Reintentar</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => { manager.dismissDialog(); router.push('/bluetooth-devices'); }}><Text style={styles.cancel}>Revisar redes</Text></Pressable>
        </> : null}
        <Pressable accessibilityRole="button" onPress={closeDialog}><Text style={styles.cancel}>{connectionFailed ? 'Cerrar' : 'Cancelar'}</Text></Pressable>
      </View></View>
    </Modal>
  </WifiLensContext.Provider>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#0008' },
  dialog: { gap: 20, borderRadius: 16, padding: 24, backgroundColor: '#FFFFFF', alignItems: 'center' },
  message: { color: '#3C1642', fontSize: 18, textAlign: 'center' }, cancel: { color: '#6A0DAD', fontSize: 17, padding: 8 },
});
