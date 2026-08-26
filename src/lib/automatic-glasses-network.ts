import {
  connectGlassesToNetwork,
  type AnnyBluetoothDevice,
} from './bluetooth-glasses';
import {
  clearActiveGlassesNetwork,
  getSavedGlassesNetworks,
  setActiveGlassesNetwork,
  type SavedGlassesNetwork,
} from './glasses-networks';
import { scanAvailableWifiNetworks } from './wifi-scanner';

export type AutomaticGlassesNetworkResult =
  | { status: 'connected'; network: SavedGlassesNetwork }
  | { status: 'connection-failed'; network: SavedGlassesNetwork }
  | { status: 'no-nearby-match' }
  | { status: 'no-saved-networks' };

let pendingConnection: Promise<AutomaticGlassesNetworkResult> | null = null;
let pendingDeviceId = '';

function normalizeSsid(ssid: string) {
  return ssid.trim().toLocaleLowerCase();
}

async function connectToNearbySavedNetwork(
  glasses: AnnyBluetoothDevice,
): Promise<AutomaticGlassesNetworkResult> {
  const savedNetworks = await getSavedGlassesNetworks();
  await clearActiveGlassesNetwork();

  if (savedNetworks.length === 0) {
    return { status: 'no-saved-networks' };
  }

  const nearbySsids = await scanAvailableWifiNetworks();
  const normalizedNearbySsids = new Set(nearbySsids.map(normalizeSsid));
  const matchingNetwork = savedNetworks.find((network) =>
    normalizedNearbySsids.has(normalizeSsid(network.ssid)),
  );

  if (!matchingNetwork) {
    console.info('[AnnyWiFi] No hay redes guardadas disponibles cerca.');
    return { status: 'no-nearby-match' };
  }

  console.info('[AnnyWiFi] Red guardada cercana detectada', {
    deviceId: glasses.id,
    ssid: matchingNetwork.ssid,
  });
  const connected = await connectGlassesToNetwork(
    glasses.id,
    matchingNetwork.ssid,
    matchingNetwork.password,
  );

  if (!connected) {
    return { status: 'connection-failed', network: matchingNetwork };
  }

  await setActiveGlassesNetwork(glasses.id, matchingNetwork);
  return { status: 'connected', network: matchingNetwork };
}

export async function connectGlassesToNearbySavedNetwork(
  glasses: AnnyBluetoothDevice,
) {
  if (pendingConnection && pendingDeviceId === glasses.id) {
    return pendingConnection;
  }

  pendingDeviceId = glasses.id;
  pendingConnection = connectToNearbySavedNetwork(glasses);
  try {
    return await pendingConnection;
  } finally {
    pendingConnection = null;
    pendingDeviceId = '';
  }
}
