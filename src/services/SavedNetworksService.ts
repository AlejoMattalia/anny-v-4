import { SavedNetwork, NetworkType } from '../types/savedNetwork';
import { deletePersistentValue, readPersistentValue, writePersistentValue } from '../lib/persistent-storage';

const AsyncStorage = {
  getItem: (key: string) => readPersistentValue(`wifi-v3-${key}.json`),
  setItem: (key: string, value: string) => writePersistentValue(`wifi-v3-${key}.json`, value),
  removeItem: (key: string) => deletePersistentValue(`wifi-v3-${key}.json`),
};

const STORAGE_KEY = 'saved_networks';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

const SavedNetworksService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {listeners.delete(listener);};
  },
  async getAll(): Promise<SavedNetwork[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return JSON.parse(raw) as SavedNetwork[];
    } catch (error) {
      console.error('[SavedNetworksService] Error reading networks:', error);
      return [];
    }
  },

  async getByType(type: NetworkType): Promise<SavedNetwork[]> {
    const all = await this.getAll();
    return all.filter(n => n.type === type);
  },

  async add(ssid: string, password: string, type: NetworkType): Promise<SavedNetwork> {
    const all = await this.getAll();

    // Check if already exists (same ssid + type)
    const existingIndex = all.findIndex(n => n.ssid === ssid && n.type === type);
    if (existingIndex !== -1) {
      // Update password
      all[existingIndex].password = password;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      notify();
      return all[existingIndex];
    }

    const network: SavedNetwork = {
      id: `${type}_${Date.now()}`,
      ssid,
      password,
      type,
      createdAt: Date.now(),
    };

    all.push(network);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));

    // Also keep backward compatibility with old ssid/pass keys
    await AsyncStorage.setItem('ssid', ssid);
    await AsyncStorage.setItem('pass', password);

    notify();
    return network;
  },

  async update(id: string, newSSID: string, newPassword: string): Promise<SavedNetwork | null> {
    const all = await this.getAll();
    const index = all.findIndex(n => n.id === id);
    if (index === -1) {
      return null;
    }
    if (all.some(n => n.id !== id && n.type === all[index].type && n.ssid === newSSID)) {
      throw new Error('Ya hay una red guardada con ese nombre y tipo.');
    }
    all[index].ssid = newSSID;
    all[index].password = newPassword;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    notify();
    return all[index];
  },

  async remove(id: string): Promise<void> {
    const all = await this.getAll();
    const networkToRemove = all.find(n => n.id === id);
    const filtered = all.filter(n => n.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

    // Limpiar claves viejas si la red eliminada era la última seleccionada activa
    if (networkToRemove) {
      const activeSSID = await AsyncStorage.getItem('ssid');
      if (activeSSID === networkToRemove.ssid) {
        await AsyncStorage.removeItem('ssid');
        await AsyncStorage.removeItem('pass');
      }
    }
    notify();
  },

  async getSorted(preferredType?: NetworkType): Promise<SavedNetwork[]> {
    const all = await this.getAll();
    const preferred = preferredType || await this.getPreference();
    // Priority: preferred type first, then the other. Within each group, newest first.
    return all.sort((a, b) => {
      if (a.type === preferred && b.type !== preferred) {
        return -1;
      }
      if (a.type !== preferred && b.type === preferred) {
        return 1;
      }
      return b.createdAt - a.createdAt;
    });
  },

  /**
   * Get the user's network preference (wifi or hotspot).
   * Defaults to 'wifi'.
   */
  async getPreference(): Promise<NetworkType> {
    try {
      const pref = await AsyncStorage.getItem('network_preference');
      if (pref === 'hotspot') {
        return 'hotspot';
      }
      return 'wifi';
    } catch {
      return 'wifi';
    }
  },

  /**
   * Set the user's network preference (wifi or hotspot).
   */
  async setPreference(type: NetworkType): Promise<void> {
    await AsyncStorage.setItem('network_preference', type);
  },

  /**
   * Migrate old single ssid/pass format to the new saved networks list.
   * Call this once on app startup.
   */
  async migrateOldFormat(): Promise<void> {
    // Método obsoleto. Se desactivó para evitar que redes eliminadas vuelvan a aparecer.
    return;
  },
};

export default SavedNetworksService;
