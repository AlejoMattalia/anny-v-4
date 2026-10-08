import { deletePersistentValue, readPersistentValue, writePersistentValue } from '../lib/persistent-storage';
import { getSavedGlassesNetworks } from '../lib/glasses-networks';
import { checkLocalWifiLens, loadLensPairing, saveLensPairing } from './LocalWifiLens';
import SavedNetworksService from './SavedNetworksService';

/** Carry existing v4 networks over once; pairing credentials move into Android Keystore. */
export async function migrateWifiLens() {
  const key = 'wifi-v3-migrated.json';
  if (await readPersistentValue(key)) return;
  if (!(await SavedNetworksService.getAll()).length) {
    for (const network of await getSavedGlassesNetworks()) {
      await SavedNetworksService.add(network.ssid, network.password, network.type);
    }
  }
  const previous = await readPersistentValue('anny-wifi-lens.json');
  if (previous && !(await loadLensPairing())) {
    const lens = JSON.parse(previous) as { baseUrl: string; password: string };
    const state = await checkLocalWifiLens(lens.baseUrl, lens.password);
    const saved = await SavedNetworksService.getAll();
    // Never sync an empty/unrelated list over the lens's working networks.
    if (!saved.some((network) => network.ssid === state.ssid)) return;
    const ap = state.hostname.replace(/\.local$/, '').replace(/^lentes-/i, 'Lentes-');
    await saveLensPairing({ ap, password: lens.password, address: lens.baseUrl, networkType: state.network_type ?? 'wifi' });
  }
  if (previous && await loadLensPairing()) {
    await deletePersistentValue('anny-wifi-lens.json');
  }
  await writePersistentValue(key, 'true');
}
