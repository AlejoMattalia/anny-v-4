import { migrateWifiLens } from '../src/services/migrateWifiLens';
import type { LensPairing } from '../src/services/LocalWifiLens';
import type { SavedNetwork } from '../src/types/savedNetwork';

const mockStorage = new Map<string, string>();
let mockPair: LensPairing | null = null;
let mockNetworks: SavedNetwork[] = [];
const mockState = jest.fn();
const mockSave = jest.fn(async (pair: LensPairing) => { mockPair = pair; });
const mockOldNetworks = jest.fn();
jest.mock('../src/lib/persistent-storage', () => ({
  readPersistentValue: async (key: string) => mockStorage.get(key) ?? null,
  writePersistentValue: async (key: string, value: string) => { mockStorage.set(key, value); },
  deletePersistentValue: async (key: string) => { mockStorage.delete(key); },
}));
jest.mock('../src/lib/glasses-networks', () => ({ getSavedGlassesNetworks: () => mockOldNetworks() }));
jest.mock('../src/services/SavedNetworksService', () => ({
  __esModule: true,
  default: {
    getAll: async () => mockNetworks,
    add: async (ssid: string, password: string, type: 'wifi' | 'hotspot') => {
      mockNetworks.push({ ssid, password, type, id: ssid, createdAt: 1 });
    },
  },
}));
jest.mock('../src/services/LocalWifiLens', () => ({
  checkLocalWifiLens: () => mockState(),
  loadLensPairing: async () => mockPair,
  saveLensPairing: (pair: LensPairing) => mockSave(pair),
}));

beforeEach(() => {
  jest.clearAllMocks(); mockStorage.clear(); mockNetworks = []; mockPair = null;
  mockStorage.set('anny-wifi-lens.json', JSON.stringify({ baseUrl: 'http://192.168.1.20', password: 'camera-test-secret' }));
  mockOldNetworks.mockResolvedValue([{ ssid: 'Home', password: 'wifi-test-secret', type: 'wifi' }]);
  mockState.mockResolvedValue({ hostname: 'lentes-123abc.local', ssid: 'Home', network_type: 'wifi' });
});

it('migrates existing networks and encrypts pairing before removing the old credential file', async () => {
  await migrateWifiLens();
  expect(mockNetworks).toHaveLength(1);
  expect(mockPair).toMatchObject({ ap: 'Lentes-123abc', address: 'http://192.168.1.20', password: 'camera-test-secret' });
  expect(mockStorage.has('anny-wifi-lens.json')).toBe(false);
  await migrateWifiLens();
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('does not adopt a pairing that could sync an empty list over the working lens', async () => {
  mockOldNetworks.mockResolvedValue([]);
  await migrateWifiLens();
  expect(mockPair).toBeNull();
  expect(mockStorage.has('anny-wifi-lens.json')).toBe(true);
  expect(mockStorage.has('wifi-v3-migrated.json')).toBe(false);
});

it('preserves credentials if the verified lens is unavailable during migration', async () => {
  mockState.mockRejectedValue(new Error('offline'));
  await expect(migrateWifiLens()).rejects.toThrow('offline');
  expect(mockStorage.has('anny-wifi-lens.json')).toBe(true);
  expect(mockPair).toBeNull();
});

it('keeps an existing native pairing and removes the obsolete plaintext file', async () => {
  mockPair = { ap: 'Lentes-aabbcc', address: 'http://192.168.1.22', password: 'already-encrypted' };
  await migrateWifiLens();
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockState).not.toHaveBeenCalled();
  expect(mockStorage.has('anny-wifi-lens.json')).toBe(false);
});
