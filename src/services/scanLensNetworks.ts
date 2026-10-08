import {PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type {NearbyLensNetwork} from './WifiLensConnectionManager';

export async function scanLensNetworks(): Promise<NearbyLensNetwork[]> {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const allowed =
      (await PermissionsAndroid.check(permission)) ||
      (await PermissionsAndroid.request(permission)) ===
        PermissionsAndroid.RESULTS.GRANTED;
    if (!allowed)
      {throw new Error('Permití ubicación para buscar redes WiFi cercanas.');}
  }
  let raw: unknown;
  try {
    raw = await WifiManager.reScanAndLoadWifiList();
  } catch {
    raw = await WifiManager.loadWifiList();
  }
  if (typeof raw === 'string') {raw = JSON.parse(raw);}
  if (!Array.isArray(raw))
    {throw new Error('No se pudo actualizar la búsqueda WiFi.');}
  return raw
    .filter(entry => typeof entry.SSID === 'string' && entry.SSID.length > 0)
    .map(entry => ({
      ssid: entry.SSID,
      signal: Number(entry.level) || -100,
      frequency: Number(entry.frequency) || undefined,
    }));
}
