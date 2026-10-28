import Constants from 'expo-constants';
import { getNearbyPlaces, isGeneralNearbyQuery } from '../../src/lib/nearby-places';
jest.mock('expo-constants', () => ({ expoConfig: { extra: { googleMapKey: 'test-key' } } }));
const origin = { latitude: -33.123, longitude: -64.349 };
const google = (name: string, types = ['point_of_interest', 'establishment'], latitude = -33.124) => ({ place_id: name, name, vicinity: 'San Martín 120', types, geometry: { location: { lat: latitude, lng: -64.349 } } });
const json = (data: unknown) => ({ ok: true, json: async () => data } as Response);
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
it('lists real nearby businesses in distance order and excludes the city and distant matches', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ status: 'OK', results: [google('Ciudad', ['locality', 'political']), google('Lejos', undefined, -31.42), google('Farmacia', undefined, -33.125), google('Kiosco')] }));
  const places = await getNearbyPlaces(origin, true);
  expect(places.map(place => place.name)).toEqual(['Kiosco', 'Farmacia']);
  expect(places[0]).toMatchObject({ address: 'San Martín 120', distanceMeters: expect.any(Number) });
  expect(await getNearbyPlaces(origin)).toBe(places);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('falls back to open maps when Google is unavailable and sorts before limiting', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ status: 'REQUEST_DENIED' })).mockResolvedValueOnce(json({ elements: [
    { type: 'node', id: 1, lat: -33.124, lon: -64.349, tags: { name: 'Panadería', shop: 'bakery', 'addr:street': 'San Martín', 'addr:housenumber': '120' } },
    { type: 'node', id: 2, lat: -31.42, lon: -64.349, tags: { name: 'Otra ciudad', shop: 'bakery' } },
  ] }));
  expect(await getNearbyPlaces(origin, true)).toMatchObject([{ name: 'Panadería', address: 'San Martín 120' }]);
  expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('data')).toContain('out center;');
});
it('does not leave Explore loading forever on an unresponsive map provider', async () => {
  jest.useFakeTimers();
  (Constants.expoConfig!.extra as any).googleMapKey = '';
  jest.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(() => {}));
  const rejected = expect(getNearbyPlaces(origin, true)).rejects.toThrow('tardó demasiado');
  await jest.advanceTimersByTimeAsync(22000); await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
it('distinguishes a general nearby request from a category or an explicitly requested city', () => {
  for (const query of ['', 'lugares cercanos', '¿Qué comercios hay cerca de mí?', 'negocios alrededor']) expect(isGeneralNearbyQuery(query)).toBe(true);
  for (const query of ['farmacias cercanas', 'lugares en Rosario', 'Terminal de Río Cuarto']) expect(isGeneralNearbyQuery(query)).toBe(false);
});
