import { deletePersistentValue, readPersistentValue, writePersistentValue } from './persistent-storage';

export type GlassesNetworkType = 'hotspot' | 'wifi';

export type SavedGlassesNetwork = {
  id: string;
  ssid: string;
  password: string;
  type: GlassesNetworkType;
  updatedAt: number;
};

export type ActiveGlassesNetwork = {
  deviceId: string;
  ssid: string;
  type: GlassesNetworkType;
  confirmedAt: number;
};

const networksKey = 'anny-glasses-networks.json';
const activeNetworkKey = 'anny-active-glasses-network.json';
const activeNetworkChangeListeners = new Set<() => void>();

export async function getSavedGlassesNetworks(): Promise<SavedGlassesNetwork[]> {
  try {
    const content = await readPersistentValue(networksKey);
    if (!content) return [];
    const networks = JSON.parse(content) as SavedGlassesNetwork[];
    return networks.sort((first, second) => second.updatedAt - first.updatedAt);
  } catch {
    return [];
  }
}

export async function saveGlassesNetwork(
  ssid: string,
  password: string,
  type: GlassesNetworkType,
) {
  const networks = await getSavedGlassesNetworks();
  const existing = networks.find(
    (network) => network.type === type && network.ssid.toLowerCase() === ssid.toLowerCase(),
  );
  const nextNetwork: SavedGlassesNetwork = {
    id: existing?.id ?? `${type}-${Date.now()}`,
    ssid,
    password,
    type,
    updatedAt: Date.now(),
  };
  const nextNetworks = [
    nextNetwork,
    ...networks.filter((network) => network.id !== nextNetwork.id),
  ];
  await writePersistentValue(networksKey, JSON.stringify(nextNetworks));
  return nextNetwork;
}

export async function deleteGlassesNetwork(id: string) {
  const networks = await getSavedGlassesNetworks();
  await writePersistentValue(
    networksKey,
    JSON.stringify(networks.filter((network) => network.id !== id)),
  );
}

export async function getActiveGlassesNetwork(): Promise<ActiveGlassesNetwork | null> {
  try {
    const content = await readPersistentValue(activeNetworkKey);
    return content ? (JSON.parse(content) as ActiveGlassesNetwork) : null;
  } catch {
    return null;
  }
}

export async function setActiveGlassesNetwork(
  deviceId: string,
  network: Pick<SavedGlassesNetwork, 'ssid' | 'type'>,
) {
  const activeNetwork: ActiveGlassesNetwork = {
    deviceId,
    ssid: network.ssid,
    type: network.type,
    confirmedAt: Date.now(),
  };
  await writePersistentValue(activeNetworkKey, JSON.stringify(activeNetwork));
  activeNetworkChangeListeners.forEach((listener) => listener());
  return activeNetwork;
}

export async function clearActiveGlassesNetwork() {
  await deletePersistentValue(activeNetworkKey);
  activeNetworkChangeListeners.forEach((listener) => listener());
}

export function subscribeToActiveGlassesNetworkChanges(listener: () => void) {
  activeNetworkChangeListeners.add(listener);
  return () => {
    activeNetworkChangeListeners.delete(listener);
  };
}
