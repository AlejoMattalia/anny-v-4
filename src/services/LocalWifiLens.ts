import {hasLocalLensTransport, requestLocalLens} from './LocalLensTransport';
import {scanLensNetworks} from './scanLensNetworks';
import {Buffer} from 'buffer';
import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import {normalizeLocalLensAddress} from './localLensAddress';
import type {NetworkType, SavedNetwork} from '../types/savedNetwork';
import {validateLensWifi, discoverAndConfigureLens} from './LensAutoProvisioning';

export type LensPairing = {
  id?: string;
  ap: string;
  password: string;
  address: string;
  networkType?: 'wifi' | 'hotspot';
};
export type LensStatus = {
  camera: boolean;
  connected: boolean;
  ap_active: boolean;
  ssid: string;
  ip: string;
  hostname: string;
  saved: boolean;
  result: string;
  multi?: number;
  network_mode?: NetworkType;
  network_type?: NetworkType;
  network_count?: number;
};
let requestedPhoneWifi = false;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const saveLensPairing = (pair: LensPairing): Promise<void> =>
  NativeModules.LocalLensCredentials.set(JSON.stringify(pair));
export async function loadLensPairing(): Promise<LensPairing | null> {
  const value = await NativeModules.LocalLensCredentials.get();
  if (!value) {
    return null;
  }
  const pair = JSON.parse(value);
  if (
    !/^Lentes-[a-f0-9]{6}$/i.test(pair.ap) ||
    typeof pair.password !== 'string' ||
    !pair.password
  ) {
    throw new Error('Volvé a vincular los lentes.');
  }
  return {...pair, address: normalizeLocalLensAddress(pair.address)};
}
export async function lensRequest(
  address: string,
  password: string,
  path: string,
  data?: string,
  timeoutMs = 12000,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) {controller.abort();}
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const nativeResponse = hasLocalLensTransport()
      ? await requestLocalLens(`${normalizeLocalLensAddress(address)}${path}`, password, data, timeoutMs, controller.signal)
      : null;
    const response = nativeResponse ? {
      status: nativeResponse.status,
      ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
      json: async () => JSON.parse(nativeResponse.body),
    } : await fetch(
      `${normalizeLocalLensAddress(address)}${path}`,
      {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `admin:${password}`,
            'utf8',
          ).toString('base64')}`,
          'X-Lentes-Request': '1',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: data,
        signal: controller.signal,
      },
    );
    if (response.status === 401) {
      throw new Error('La clave de vinculación de los lentes fue rechazada.');
    }
    if (response.status === 409) {
      throw new Error(
        'Los lentes ya están probando otra conexión. Esperá a que termine.',
      );
    }
    if (!response.ok) {
      throw new Error(
        'Los lentes rechazaron la solicitud. Revisá los datos e intentá nuevamente.',
      );
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
export async function checkLocalWifiLens(
  address: string,
  password: string,
  timeoutMs = 12000,
  signal?: AbortSignal,
): Promise<LensStatus> {
  const state = await lensRequest(
    address,
    password,
    '/api/status',
    undefined,
    timeoutMs,
    signal,
  );
  if (
    typeof state.camera !== 'boolean' ||
    typeof state.ap_active !== 'boolean' ||
    typeof state.connected !== 'boolean'
  ) {
    throw new Error('El dispositivo no es compatible.');
  }
  return state;
}
export async function findLocalLens(
  pair: LensPairing,
  signal?: AbortSignal,
): Promise<{address: string; state: LensStatus}> {
  const endpoints = [
    ...new Set([
      pair.address,
      `http://${pair.ap.toLowerCase()}.local`,
      'http://192.168.4.1',
    ]),
  ];
  for (const address of endpoints) {
    if (signal?.aborted) {throw new Error('Conexión cancelada.');}
    const started = Date.now();
    try {
      // mDNS is a discovery alias. Android's native HTTP/UDP video resolver
      // may not resolve it even when fetch just found the lens through it.
      const state = await checkLocalWifiLens(address, pair.password, address === pair.address ? 12000 : 2500, signal);
      const canonical = normalizeLocalLensAddress(address);
      const alias = /\.local(:[0-9]+)?$/.exec(canonical);
      const resolved = alias && state.connected && /^\d+\.\d+\.\d+\.\d+$/.test(state.ip)
        ? normalizeLocalLensAddress(`${state.ip}${alias[1] || ''}`)
        : canonical;
      return {
        address: resolved,
        state,
      };
    } catch (error) {
      if (!signal?.aborted) {
        console.warn('[WifiLensProbe]', address, 'elapsed_ms=', Date.now() - started,
          error instanceof Error ? error.message : 'Error de consulta');
      }
      /* Try the next known address. */
    }
  }
  throw new Error(
    'No se encontraron los lentes. Encendelos y acercalos al celular.',
  );
}
async function joinWifi(ssid: string, password: string, setup = false) {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Permití el acceso a ubicación para conectar el Wi-Fi.');
    }
  }
  const current = await WifiManager.getCurrentWifiSSID().catch(() => '');
  if (current.replace(/^"|"$/g, '') !== ssid) {
    requestedPhoneWifi = true;
    await WifiManager.connectToProtectedWifiSSID({
      ssid,
      password: password || null,
      isWEP: false,
      isHidden: false,
      timeout: 30,
    });
  }
  if (Platform.OS === 'android') {
    await WifiManager.forceWifiUsageWithOptions(true, {noInternet: setup});
  }
}
export async function releaseLensNetwork() {
  if (Platform.OS === 'android') {
    await WifiManager.forceWifiUsageWithOptions(false, {
      noInternet: false,
    }).catch(() => {});
  }
}
export async function configureLocalLens(
  pair: LensPairing | null,
  ssid: string,
  password: string,
  onProgress: (message: string) => void,
  signal: AbortSignal,
  networkType: 'wifi' | 'hotspot' = 'wifi',
): Promise<LensPairing> {
  if (signal.aborted) {throw new Error('Conexión cancelada.');}
  // A previous Wi-Fi binding must not direct requests to the old LAN when
  // the lens moves to a hotspot or another router.
  await releaseLensNetwork();
  if (signal.aborted) {throw new Error('Conexión cancelada.');}
  try {
    const found = await discoverAndConfigureLens(
      ssid, password, onProgress, signal, pair?.id, networkType,
    );
    const configured = {...found, address: normalizeLocalLensAddress(found.address), networkType};
    if (signal.aborted) {throw new Error('Conexión cancelada.');}
    onProgress(networkType === 'hotspot'
      ? 'Verificando los lentes en el hotspot…'
      : `Conectando el celular a ${ssid}…`);
    if (networkType === 'wifi') {await joinWifi(ssid, password);}
    else {
      // An own hotspot is reachable without joining Wi-Fi. If another phone
      // hosts it, this phone must join that SSID too (including secondary Wi-Fi).
      let reachable = false;
      try {
        const state = await checkLocalWifiLens(configured.address, configured.password, 2500, signal);
        reachable = state.connected && state.ssid === ssid;
      } catch { /* Inspect the nearby network before deciding to join. */ }
      if (signal.aborted) {throw new Error('Conexión cancelada.');}
      if (!reachable) {
        const nearby = await scanLensNetworks().catch(() => []);
        const phoneSSID = await WifiManager.getCurrentWifiSSID().catch(() => '');
        if (signal.aborted) {throw new Error('Conexión cancelada.');}
        if (phoneSSID.replace(/^"|"$/g, '') === ssid || nearby.some(network => network.ssid === ssid)) {
          onProgress(`Conectando este celular al hotspot ${ssid}…`);
          await joinWifi(ssid, password);
        } else if (requestedPhoneWifi) {
          await WifiManager.disconnect().catch(() => {});
          requestedPhoneWifi = false;
        }
      }
    }
    await releaseLensNetwork();
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal.aborted) {throw new Error('Conexión cancelada.');}
      try {
        const state = await checkLocalWifiLens(configured.address, configured.password, 8000, signal);
        if (signal.aborted) {throw new Error('Conexión cancelada.');}
        // Keep the last working pairing until the new network is reachable.
        // The connection owner persists this pair only after final confirmation.
        if (state.connected && state.ssid === ssid) {return configured;}
      } catch {
        if (signal.aborted) {throw new Error('Conexión cancelada.');}
      }
      await sleep(1500);
    }
    throw new Error(networkType === 'hotspot'
      ? 'No se pudo acceder a los lentes. Activá el hotspot guardado; si lo comparte otro celular, conectá este celular a esa misma red.'
      : 'No se pudo acceder a los lentes en la nueva red. Conectá el celular a ese Wi-Fi y reintentá.');
  } finally {
    // Both a successful switch and a cancelled attempt release the old route.
    await releaseLensNetwork();
  }
}

/** Atomically persist both lists; firmware retries only the selected type. */
export async function syncLensNetworks(
  pair: LensPairing,
  networks: SavedNetwork[],
  mode: NetworkType,
  signal: AbortSignal,
): Promise<string> {
  const state = await checkLocalWifiLens(pair.address, pair.password, 5000, signal);
  if (state.multi !== 1) {
    return 'Actualizá los lentes para guardar varias redes y cambiar entre ellas.';
  }
  if (networks.length > 8) {
    throw new Error('Los lentes admiten hasta 8 redes en total. Eliminá alguna para sincronizar.');
  }
  const fields: [string, string][] = [['count', String(networks.length)], ['mode', mode]];
  networks.forEach((network, index) => {
    validateLensWifi(network.ssid, network.password);
    fields.push([`ssid${index}`, network.ssid], [`password${index}`, network.password], [`type${index}`, network.type]);
  });
  const data = fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  await lensRequest(pair.address, pair.password, '/api/networks', data, 8000, signal);
  return `${networks.length} redes guardadas en los lentes.`;
}
