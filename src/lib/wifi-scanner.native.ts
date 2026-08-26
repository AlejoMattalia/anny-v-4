import WifiManager from 'react-native-wifi-reborn';
import { PermissionsAndroid, Platform } from 'react-native';

export async function scanAvailableWifiNetworks(): Promise<string[]> {
  if (Platform.OS !== 'android') return [];

  const permission = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Buscar redes WiFi',
      message: 'Anny necesita la ubicación para mostrar las redes WiFi cercanas.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Cancelar',
    },
  );
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Se necesita el permiso de ubicación para buscar redes WiFi cercanas.');
  }

  const entries = await WifiManager.reScanAndLoadWifiList();
  return Array.from(
    new Set(
      entries
        .map((entry) => entry.SSID?.trim())
        .filter((ssid): ssid is string => Boolean(ssid)),
    ),
  ).sort((first, second) => first.localeCompare(second));
}
