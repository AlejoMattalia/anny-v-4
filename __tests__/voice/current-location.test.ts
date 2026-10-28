import * as Location from 'expo-location';
import { getCurrentLocation, getExplorationLocation, reverseGeocodeLocation } from '../../src/lib/current-location';
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' }, Accuracy: { Balanced: 3, High: 4 },
  reverseGeocodeAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(),
}));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
});
afterEach(() => jest.useRealTimers());
it('uses granted location permission without reopening a native dialog', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: -33.123, longitude: -64.349, accuracy: 10 }, timestamp: Date.now() });
  expect(await getCurrentLocation({ allowCached: false })).toMatchObject({ latitude: -33.123 });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});
it('clears a stalled GPS request so the next trip can locate again', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  const pending = getCurrentLocation({ allowCached: false });
  const rejected = expect(pending).rejects.toThrow('GPS');
  await jest.advanceTimersByTimeAsync(20000); await rejected;
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: -33.123, longitude: -64.349, accuracy: 10 }, timestamp: Date.now() });
  await expect(getCurrentLocation({ allowCached: false })).resolves.toMatchObject({ latitude: -33.123 });
});

it('requests high precision for conversation lookups instead of accepting balanced mode', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: -33.123, longitude: -64.349, accuracy: 10 }, timestamp: Date.now() });
  await getCurrentLocation({ allowCached: false, highAccuracy: true });
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 4 }));
});

it('continues to current GPS when Android cannot read its cached position', async () => {
  jest.setSystemTime(Date.now() + 60000);
  (Location.getLastKnownPositionAsync as jest.Mock).mockRejectedValueOnce(new Error('cache unavailable'));
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({ coords: { latitude: -33, longitude: -64, accuracy: 80 }, timestamp: Date.now() });
  await expect(getExplorationLocation()).resolves.toMatchObject({ latitude: -33, accuracy: 80 });
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 4 }));
});
it('keeps the native street even when formattedAddress contains only the city', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockResolvedValueOnce([{ street: 'San Martín', streetNumber: '120', city: 'Río Cuarto', formattedAddress: 'Río Cuarto' }]);
  expect(await reverseGeocodeLocation({ latitude: -33, longitude: -64 })).toBe('San Martín 120, Río Cuarto');
});
it('looks up the street when the native geocoder supplies only the city', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockResolvedValueOnce([{ city: 'Río Cuarto', formattedAddress: 'Río Cuarto' }]);
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ address: { road: 'San Martín', house_number: '120', city: 'Río Cuarto' } }) } as Response);
  expect(await reverseGeocodeLocation({ latitude: -33, longitude: -64 })).toBe('San Martín, 120, Río Cuarto');
  expect(String(fetchMock.mock.calls[0][0])).toContain('/reverse?'); fetchMock.mockRestore();
});
it('preserves offline coordinates and explains that the street is unavailable', async () => {
  (Location.reverseGeocodeAsync as jest.Mock).mockRejectedValueOnce(new Error('no geocoder'));
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
  expect(await reverseGeocodeLocation({ latitude: -33, longitude: -64 })).toContain('No pude determinar la dirección. Coordenadas: -33.000000, -64.000000');
  fetchMock.mockRestore();
});
