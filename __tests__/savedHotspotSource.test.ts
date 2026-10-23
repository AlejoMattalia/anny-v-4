import SavedNetworksService from '../src/services/SavedNetworksService';

const mockStorage = new Map<string, string>();
jest.mock('../src/lib/persistent-storage', () => ({
  readPersistentValue: async (key: string) => mockStorage.get(key) ?? null,
  writePersistentValue: async (key: string, value: string) => {mockStorage.set(key, value);},
  deletePersistentValue: async (key: string) => {mockStorage.delete(key);},
}));
beforeEach(() => {mockStorage.clear();});

it('remembers manual disconnection without removing networks or changing their mode', async () => {
  await SavedNetworksService.add('Phone', 'test-password', 'hotspot', 'this-phone');
  await SavedNetworksService.setPreference('hotspot');
  expect(await SavedNetworksService.getDisconnected()).toBe(false);
  await SavedNetworksService.setDisconnected(true);
  expect(await SavedNetworksService.getDisconnected()).toBe(true);
  expect(await SavedNetworksService.getAll()).toHaveLength(1);
  expect(await SavedNetworksService.getPreference()).toBe('hotspot');
  await SavedNetworksService.setDisconnected(false);
  expect(await SavedNetworksService.getDisconnected()).toBe(false);
});

it('persists which phone hosts a hotspot across reads and password edits', async () => {
  const saved = await SavedNetworksService.add('Phone', 'test-password', 'hotspot', 'this-phone');
  expect((await SavedNetworksService.getAll())[0].hotspotSource).toBe('this-phone');
  await SavedNetworksService.update(saved.id, 'Phone renamed', 'updated-password');
  expect((await SavedNetworksService.getAll())[0]).toMatchObject({ssid: 'Phone renamed', hotspotSource: 'this-phone'});
  await SavedNetworksService.update(saved.id, 'Phone renamed', 'updated-password', 'other-phone');
  expect((await SavedNetworksService.getAll())[0].hotspotSource).toBe('other-phone');
});

it('keeps legacy hotspot auto detection until its source is explicitly selected', async () => {
  await SavedNetworksService.add('Legacy phone', 'test-password', 'hotspot');
  expect((await SavedNetworksService.getAll())[0].hotspotSource).toBeUndefined();
  await SavedNetworksService.add('Legacy phone', 'test-password', 'hotspot', 'this-phone');
  expect(await SavedNetworksService.getAll()).toEqual([expect.objectContaining({hotspotSource: 'this-phone'})]);
});

it('does not mark a router as a hotspot', async () => {
  const saved = await SavedNetworksService.add('Home', 'test-password', 'wifi', 'this-phone');
  await SavedNetworksService.update(saved.id, 'Home', 'updated-password', 'other-phone');
  expect((await SavedNetworksService.getAll())[0].hotspotSource).toBeUndefined();
});
