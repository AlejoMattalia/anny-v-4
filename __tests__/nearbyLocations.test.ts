import Constants from 'expo-constants';
import { nearbyDestinationQuery, destinationSearchIntent, searchNearbyLocations } from '../src/lib/location-search';
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
const gps = { latitude: -33.123, longitude: -64.349 };
const point = (id: number, name: string, lat: number, lon: number) => ({ place_id: id, display_name: name, lat: String(lat), lon: String(lon) });
const json = (data: unknown) => ({ ok: true, json: async () => data } as Response);
const google = (id: string, name: string, latitude: number, longitude: number) => ({ place_id: id, name, vicinity: `${name}, Río Cuarto`, geometry: { location: { lat: latitude, lng: longitude } } });
beforeEach(() => { delete process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY; (Constants.expoConfig!.extra as any).googleMapKey = ''; });
afterEach(() => jest.restoreAllMocks());
it('recognizes categories and variants without inventing a city', () => {
  for (const query of ['a la terminal', 'la terminal más cercana', 'la terminal más cerca']) expect(nearbyDestinationQuery(query)).toBe('[bus_station]');
  for (const query of ['farmacia', 'una farmacia']) expect(nearbyDestinationQuery(query)).toBe('[pharmacy]');
  for (const query of ['al súper', 'el super más cercano', 'un supermercado']) expect(nearbyDestinationQuery(query)).toBe('[supermarket]');
  for (const query of ['shopping', 'al centro comercial']) expect(nearbyDestinationQuery(query)).toBe('[mall]');
  for (const query of ['kiosko cerca', 'un kiosco cerca de mí', 'quiosco']) expect(nearbyDestinationQuery(query)).toBe('[kiosk]');
  expect(nearbyDestinationQuery('Terminal de Córdoba')).toBeNull();
  expect(destinationSearchIntent('farmacia en Rosario')).toMatchObject({ locality: 'rosario', category: { phrase: '[pharmacy]' } });
});
it('searches all mapped category elements and sorts nearby results without distant substitutes', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ elements: [
    { type: 'node', id: 2, tags: { name: 'Terminal Las Higueras' }, lat: -33.09, lon: -64.29 },
    { type: 'node', id: 3, tags: { name: 'Terminal Córdoba capital' }, lat: -31.42, lon: -64.18 },
    { type: 'way', id: 1, tags: { name: 'Terminal de Omnibus Río Cuarto' }, center: { lat: -33.1142408, lon: -64.3517898 } },
  ] }));
  const places = await searchNearbyLocations('la terminal', gps);
  expect(places.map(item => item.id)).toEqual(['osm-way-1', 'osm-node-2']);
  expect(places[0].distanceMeters).toBeLessThan(1100);
  const url = new URL(fetchMock.mock.calls[0][0] as string);
  expect(url.searchParams.get('data')).toContain('around:25000,-33.123,-64.349');
  expect(url.searchParams.get('data')).toContain('[amenity=bus_station]');
});
it('falls back from an unavailable category map to its bounded search index', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce(json([
    point(1, 'Farmacia local', -33.124, -64.349), point(2, 'Farmacia Córdoba', -31.42, -64.18),
  ]));
  expect((await searchNearbyLocations('farmacia', gps)).map(item => item.id)).toEqual(['1']);
  const url = new URL(fetchMock.mock.calls[1][0] as string);
  expect(url.searchParams.get('q')).toBe('[pharmacy]'); expect(url.searchParams.get('bounded')).toBe('1');
});
it('returns no distant substitute when providers really have no nearby matches', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ elements: [] })).mockResolvedValueOnce(json([point(3, 'Córdoba', -31.42, -64.18)]));
  expect(await searchNearbyLocations('la terminal', gps)).toEqual([]);
});
it('distinguishes provider failure from an empty map', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
  await expect(searchNearbyLocations('la terminal', gps)).rejects.toThrow('servicios de mapas');
});
it('uses Google Maps to find kiosk names and addresses, filters distance and sorts by GPS', async () => {
  (Constants.expoConfig!.extra as any).googleMapKey = 'test-map-key';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ status: 'OK', results: [
    google('far', 'Kiosco Córdoba', -31.42, -64.18), google('2', 'Kiosco B', -33.13, -64.35), google('1', 'Kiosco A', -33.124, -64.349),
  ] }));
  const places = await searchNearbyLocations('kiosko cerca', gps);
  expect(places.map(item => item.name)).toEqual(['Kiosco A', 'Kiosco B']); expect(places[0].address).toContain('Río Cuarto');
  const url = new URL(fetchMock.mock.calls[0][0] as string); expect(url.searchParams.get('keyword')).toBe('kiosco');
  expect(url.searchParams.get('location')).toBe('-33.123,-64.349');
});
it('an explicitly requested city overrides device search bounds without moving the device origin', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json([{ lat: '-32.947', lon: '-60.639' }])).mockResolvedValueOnce(json({ elements: [
    { type: 'node', id: 7, tags: { name: 'Farmacia Rosario' }, lat: -32.948, lon: -60.639 },
    { type: 'node', id: 8, tags: { name: 'Farmacia Río Cuarto' }, lat: -33.124, lon: -64.349 },
  ] }));
  expect((await searchNearbyLocations('farmacia en Rosario', gps)).map(item => item.name)).toEqual(['Farmacia Rosario']);
  const cityUrl = new URL(fetchMock.mock.calls[0][0] as string); expect(cityUrl.searchParams.get('city')).toBe('rosario');
  expect(cityUrl.searchParams.has('viewbox')).toBe(false);
  expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('data')).toContain('-32.947,-60.639');
  expect(gps).toEqual({ latitude: -33.123, longitude: -64.349 });
});
it('named places without another city stay bounded to GPS instead of silently becoming a distant trip', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json([point(1, 'Local Córdoba', -31.42, -64.18)]));
  expect(await searchNearbyLocations('Farmacia La Salud', gps)).toEqual([]);
  expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('bounded')).toBe('1');
});
it('shopping search keeps real malls ahead of unrelated retail stores and small galleries', async () => {
  (Constants.expoConfig!.extra as any).googleMapKey = 'test-map-key';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ status: 'OK', results: [
    { ...google('store', 'Local de ropa', -33.123, -64.349), types: ['clothing_store'] },
    { ...google('gallery', 'Galería pequeña', -33.124, -64.349), types: ['shopping_mall'] },
    { ...google('mall', 'Shopping Río Cuarto', -33.13, -64.35), types: ['shopping_mall'] },
  ] }));
  expect((await searchNearbyLocations('shopping', gps)).map(item => item.name)).toEqual(['Shopping Río Cuarto']);
  const url = new URL(fetchMock.mock.calls[0][0] as string);
  expect(url.pathname).toContain('textsearch'); expect(url.searchParams.get('query')).toBe('shopping');
});
it('human pharmacy searches exclude veterinary results even if the map labels them pharmacy', async () => {
  (Constants.expoConfig!.extra as any).googleMapKey = 'test-map-key';
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ status: 'OK', results: [
    { ...google('vet', 'Consultorio animal', -33.123, -64.349), types: ['pharmacy', 'veterinary_care'] },
    { ...google('human', 'Farmacia', -33.124, -64.349), types: ['pharmacy'] },
  ] }));
  expect((await searchNearbyLocations('farmacia', gps)).map(item => item.name)).toEqual(['Farmacia']);
});
it('a failed explicit city lookup never silently searches the device city', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
  await expect(searchNearbyLocations('farmacia en Rosario', gps)).rejects.toThrow('ciudad indicada');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('asks which city is intended when multiple distinct cities share the spoken name', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json([
    { lat: '-32.95', lon: '-60.65', display_name: 'Rosario, Santa Fe' },
    { lat: '-25.79', lon: '-64.97', display_name: 'Rosario, Salta' },
  ]));
  await expect(searchNearbyLocations('farmacia en Rosario', gps)).rejects.toThrow('¿A cuál te referís?');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
