import {PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import type {NearbyLensNetwork} from './WifiLensConnectionManager';

/** Client Wi-Fi may be off while this phone is hosting a working hotspot. */
export async function isPhoneWifiEnabled(): Promise<boolean> {
  if (Platform.OS !== 'android') {return true;}
  try {return await WifiManager.isEnabled();}
  catch {return false;}
}

function parseNetworks(raw: unknown): {SSID: string; level?: number; frequency?: number}[] {
  const entries = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(entries)) {throw new Error('No se pudo actualizar la búsqueda WiFi.');}
  return entries.filter(entry => entry && typeof entry.SSID === 'string' && entry.SSID.length > 0);
}

export async function scanLensNetworks(): Promise<NearbyLensNetwork[]> {
  // Cached SSIDs are not evidence that the phone can join a network now.
  if (!await isPhoneWifiEnabled()) {return [];}
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const allowed =
      (await PermissionsAndroid.check(permission)) ||
      (await PermissionsAndroid.request(permission)) ===
        PermissionsAndroid.RESULTS.GRANTED;
    if (!allowed)
      {throw new Error('Permití ubicación para buscar redes WiFi cercanas.');}
  }
  let entries: ReturnType<typeof parseNetworks>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Some Android devices never deliver the scan-completed broadcast. Do not
    // leave the serialized connection manager (including Cancel/Connect) stuck.
    const raw = await Promise.race([
      WifiManager.reScanAndLoadWifiList(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('La búsqueda WiFi tardó demasiado.')), 8000);
      }),
    ]);
    // The native library may resolve a throttling message instead of rejecting.
    entries = parseNetworks(raw);
  } catch {
    entries = parseNetworks(await WifiManager.loadWifiList());
  } finally {
    clearTimeout(timer);
  }
  return entries
    .map(entry => ({
      ssid: entry.SSID,
      signal: Number(entry.level) || -100,
      frequency: Number(entry.frequency) || undefined,
    }));
}
