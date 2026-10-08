import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type {NetworkType} from '../types/savedNetwork';
import SavedNetworksService from '../services/SavedNetworksService';
import {
  configureLocalLens,
  findLocalLens,
  loadLensPairing,
  saveLensPairing,
  syncLensNetworks,
} from '../services/LocalWifiLens';
import {WifiLensConnectionManager, type WifiLensConnection} from '../services/WifiLensConnectionManager';
import {scanLensNetworks} from '../services/scanLensNetworks';
import {useWifiLensAnnouncements} from './useWifiLensAnnouncements';

export function useWifiLensConnection(
  enabled: boolean,
  preference: NetworkType,
  initialized: boolean,
) {
  const [connection, setConnection] = useState<WifiLensConnection | null>(null);
  const [manager] = useState(() => new WifiLensConnectionManager(
      {
        networks: () => SavedNetworksService.getAll(),
        pairing: () => loadLensPairing(),
        scan: scanLensNetworks,
        probe: (pair, signal) => findLocalLens(pair, signal),
        configure: (pair, network, progress, signal) =>
          configureLocalLens(
            pair,
            network.ssid,
            network.password,
            progress,
            signal,
            network.type,
          ),
        save: saveLensPairing,
        sync: syncLensNetworks,
        phoneSSID: async () => (await WifiManager.getCurrentWifiSSID()).replace(/^"|"$/g, ''),
      },
      setConnection,
    ));
  useWifiLensAnnouncements(connection ?? manager.state);
  const startupAttempted = useRef(false);
  const startupSettings = useRef({enabled, initialized});
  useEffect(() => { startupSettings.current = {enabled, initialized}; }, [enabled, initialized]);
  const connectOnStartup = useCallback(() => {
    if (startupAttempted.current || !startupSettings.current.initialized || AppState.currentState !== 'active') {return;}
    startupAttempted.current = true;
    if (startupSettings.current.enabled) {manager.refresh(false, true);}
  }, [manager]);
  useEffect(() => {
    manager.setMode(enabled, preference, false);
    connectOnStartup();
    manager.poll();
  }, [enabled, preference, initialized, manager, connectOnStartup]);
  useEffect(() => SavedNetworksService.subscribe(() => manager.networksChanged()), [manager]);
  useEffect(() => {
    manager.foreground(AppState.currentState === 'active');
    connectOnStartup();
    const listener = AppState.addEventListener('change', state => {
      manager.foreground(state === 'active');
      if (state === 'active') {connectOnStartup();}
    });
    const timer = setInterval(() => {
      manager.poll();
    }, 15000);
    return () => {
      listener.remove();
      clearInterval(timer);
      manager.cancel();
    };
  }, [manager, connectOnStartup]);
  return {connection: connection ?? manager.state, manager};
}
