import Constants from 'expo-constants';

interface UserCoords {
  latitude: number;
  longitude: number;
}

export interface LocationSearchResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters?: number;
}

interface SearchLocationsOptions {
  userCoords?: UserCoords;
  preferredLocality?: string | null;
  limit?: number;
}

const DEFAULT_RESULTS_LIMIT = 5;
const NOMINATIM_FETCH_LIMIT = 10;
const LOCAL_RADIUS_METERS = 25000;
const mapKey = () => process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY?.trim() || Constants.expoConfig?.extra?.googleMapKey || '';

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractPreferredLocality(locality?: string | null) {
  if (!locality) return null;

  const normalized = normalizeText(locality);
  const tokens = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return tokens.find((token) => token.length >= 4) ?? (normalized || null);
}

export function getDistanceInKm(from: UserCoords, to: UserCoords) {
  const earthRadiusKm = 6371;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function buildSearchUrl(query: string, userCoords?: UserCoords, nearby = false) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: nearby ? '40' : NOMINATIM_FETCH_LIMIT.toString(),
    addressdetails: '1',
    'accept-language': 'es',
    countrycodes: 'ar',
  });

  if (userCoords) {
    const latitudeRange = nearby ? 25 / 111.32 : 0.45;
    const longitudeRange = nearby ? latitudeRange / Math.max(0.1, Math.cos(userCoords.latitude * Math.PI / 180)) : 0.45;
    const minLon = userCoords.longitude - longitudeRange;
    const maxLon = userCoords.longitude + longitudeRange;
    const minLat = userCoords.latitude - latitudeRange;
    const maxLat = userCoords.latitude + latitudeRange;

    params.set('viewbox', `${minLon},${maxLat},${maxLon},${minLat}`);
    params.set('lat', userCoords.latitude.toString());
    params.set('lon', userCoords.longitude.toString());
    if (nearby) params.set('bounded', '1');
  }

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

type PlaceCategory = { aliases: string[]; phrase: string; tags: string[]; googleType?: string; keyword?: string };
const categories: PlaceCategory[] = [
  { aliases: ['terminal', 'terminal de omnibus', 'terminal de buses', 'terminal de colectivos', 'estacion de omnibus'], phrase: '[bus_station]', tags: ['[amenity=bus_station]'], googleType: 'bus_station' },
  { aliases: ['farmacia', 'farmacias'], phrase: '[pharmacy]', tags: ['[amenity=pharmacy]', '[healthcare=pharmacy]'], googleType: 'pharmacy' },
  { aliases: ['hospital', 'hospitales'], phrase: '[hospital]', tags: ['[amenity=hospital]'], googleType: 'hospital' },
  { aliases: ['super', 'supermercado', 'supermercados'], phrase: '[supermarket]', tags: ['[shop=supermarket]'], googleType: 'supermarket' },
  { aliases: ['shopping', 'shopping center', 'centro comercial', 'centros comerciales'], phrase: '[mall]', tags: ['[shop=mall]', '[name~"shopping|centro comercial",i]'], googleType: 'shopping_mall', keyword: 'shopping' },
  { aliases: ['kiosco', 'kiosko', 'quiosco', 'kioscos', 'kioskos', 'quioscos'], phrase: '[kiosk]', tags: ['[shop=kiosk]', '[shop=convenience]'], keyword: 'kiosco' },
  { aliases: ['almacen', 'almacenes', 'despensa'], phrase: '[convenience]', tags: ['[shop=convenience]', '[shop=general]'], googleType: 'convenience_store' },
  { aliases: ['banco', 'bancos'], phrase: '[bank]', tags: ['[amenity=bank]'], googleType: 'bank' },
  { aliases: ['cajero', 'cajero automatico'], phrase: '[atm]', tags: ['[amenity=atm]'], googleType: 'atm' },
  { aliases: ['estacion de servicio', 'estaciones de servicio'], phrase: '[fuel]', tags: ['[amenity=fuel]'], googleType: 'gas_station' },
  { aliases: ['restaurante', 'restaurantes'], phrase: '[restaurant]', tags: ['[amenity=restaurant]'], googleType: 'restaurant' },
  { aliases: ['cafe', 'cafeteria'], phrase: '[cafe]', tags: ['[amenity=cafe]'], googleType: 'cafe' },
  { aliases: ['panaderia', 'panaderias'], phrase: '[bakery]', tags: ['[shop=bakery]'], googleType: 'bakery' },
];

export function destinationSearchIntent(query: string) {
  const text = normalizeText(query).replace(/^(quiero ir |ir |llevame |vamos )+/, '')
    .replace(/^(a la |a las |a los |al |a |la |el |los |las |una |un |unas |unos )+/, '')
    .replace(/\s+(?:mas cerca|mas cercan[oa]s?|cercan[oa]s?|cerca(?: de mi| mio)?|cerquita|de aca|de aqui)$/, '').trim();
  const direct = categories.find(category => category.aliases.includes(text));
  if (direct) return { category: direct, locality: undefined, text };
  // Only an explicitly spoken locality overrides GPS. Category names such as
  // "terminal de ómnibus" are matched above before interpreting "de".
  const localized = text.match(/^(.+?)(?:\s+en\s+|,\s*)(.+)$/);
  if (localized) return { category: categories.find(category => category.aliases.includes(localized[1])), locality: localized[2], text: localized[1] };
  for (const category of categories) {
    for (const alias of [...category.aliases].sort((a, b) => b.length - a.length)) {
      if (text.startsWith(`${alias} de `)) return { category, locality: text.slice(alias.length + 4), text: alias };
    }
  }
  return { category: undefined, locality: undefined, text };
}

export function nearbyDestinationQuery(query: string) {
  const intent = destinationSearchIntent(query);
  return intent.locality ? null : intent.category?.phrase || null;
}

async function mapJson(url: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'AnnyApp/4.0 (contact@anny.com)' }, signal: controller.signal });
    if (!response.ok) throw new Error('No pudimos consultar los lugares cercanos. Intentá nuevamente.');
    return await response.json();
  } finally { clearTimeout(timeout); }
}

function closestPlaces(results: LocationSearchResult[], center: UserCoords) {
  const unique = new Map<string, LocationSearchResult>();
  for (const item of results) {
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) continue;
    const distanceMeters = Math.round(getDistanceInKm(center, item) * 1000);
    if (distanceMeters > LOCAL_RADIUS_METERS) continue;
    const key = `${normalizeText(item.name)}:${item.latitude.toFixed(4)}:${item.longitude.toFixed(4)}`;
    unique.set(key, { ...item, distanceMeters });
  }
  return [...unique.values()].sort((a, b) => a.distanceMeters! - b.distanceMeters!);
}

async function googlePlaces(query: string, center: UserCoords, category?: PlaceCategory): Promise<LocationSearchResult[]> {
  const textSearch = !category || category.phrase === '[mall]';
  const params = new URLSearchParams({ key: mapKey(), location: `${center.latitude},${center.longitude}`, language: 'es' });
  if (textSearch) { params.set('query', category?.keyword || query); params.set('radius', String(LOCAL_RADIUS_METERS)); }
  else params.set('rankby', 'distance');
  if (category?.googleType && !textSearch) params.set('type', category.googleType);
  if (!textSearch && category?.keyword) params.set('keyword', category.keyword);
  const data = await mapJson(`https://maps.googleapis.com/maps/api/place/${textSearch ? 'textsearch' : 'nearbysearch'}/json?${params}`);
  if (!['OK', 'ZERO_RESULTS'].includes(data.status)) throw new Error('Google Maps no está disponible para esta búsqueda.');
  if (!Array.isArray(data.results)) throw new Error('El mapa no devolvió lugares válidos.');
  let results = data.results.filter((item: any) => {
    if (category?.phrase === '[pharmacy]' || category?.phrase === '[hospital]') {
      return !item.types?.includes('veterinary_care') && !/veterinari/.test(normalizeText(item.name || ''));
    }
    return true;
  });
  if (category?.phrase === '[mall]') {
    // Text search keeps the meaning of "shopping"; a type-only query can
    // otherwise rank individual clothing shops and small galleries first.
    const matchingNames = results.filter((item: any) => /shopping|centro comercial/.test(normalizeText(item.name || '')));
    results = matchingNames.length ? matchingNames : results.filter((item: any) => item.types?.includes('shopping_mall'));
  }
  return closestPlaces(results.map((item: any) => ({ id: `google-${item.place_id}`, name: item.name,
    address: item.vicinity || item.formatted_address || item.name, latitude: Number(item.geometry?.location?.lat), longitude: Number(item.geometry?.location?.lng) })), center);
}

async function osmCategoryPlaces(category: PlaceCategory, center: UserCoords): Promise<LocationSearchResult[]> {
  const selectors = category.tags.map(tag => `nwr(around:${LOCAL_RADIUS_METERS},${center.latitude},${center.longitude})${tag};`).join('');
  const data = await mapJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(`[out:json][timeout:8];(${selectors});out center;`)}`);
  if (!Array.isArray(data.elements)) throw new Error('El mapa no devolvió lugares válidos.');
  return closestPlaces(data.elements.map((item: any) => {
    const tags = item.tags || {};
    const address = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(' ');
    return { id: `osm-${item.type}-${item.id}`, name: tags.name || tags.brand || category.aliases[0], address: address || tags.name || category.aliases[0],
      latitude: Number(item.lat ?? item.center?.lat), longitude: Number(item.lon ?? item.center?.lon) };
  }), center);
}

function chooseLocality(candidates: { latitude: number; longitude: number; label: string }[], locality: string): UserCoords | undefined {
  const unique: typeof candidates = [];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude) && !unique.some(other => getDistanceInKm(other, candidate) < 10)) unique.push(candidate);
  }
  if (unique.length > 1) throw new Error(`Hay varias localidades posibles para «${locality}»: ${unique.slice(0, 3).map(item => item.label).join('; ')}. ¿A cuál te referís? No voy a elegir una ciudad por mi cuenta.`);
  return unique[0];
}

async function localityCenter(locality: string): Promise<UserCoords> {
  // No device viewbox here: an explicit city must not be biased toward GPS.
  const params = new URLSearchParams({ city: locality, countrycodes: 'ar', format: 'json', limit: '5', 'accept-language': 'es' });
  let data;
  try { data = await mapJson(`https://nominatim.openstreetmap.org/search?${params}`); }
  catch { /* Resolve the explicitly requested city through the other map. */ }
  if (Array.isArray(data)) {
    const selected = chooseLocality(data.map(item => ({ latitude: Number(item.lat), longitude: Number(item.lon), label: item.display_name || locality })), locality);
    if (selected) return selected;
  }
  if (mapKey()) {
    const params = new URLSearchParams({ address: locality, components: 'country:AR', language: 'es', key: mapKey() });
    const data = await mapJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (data.status === 'OK' && Array.isArray(data.results)) {
      if (data.results.some((item: any) => item.partial_match)) throw new Error(`El mapa sólo dio una coincidencia aproximada para «${locality}». ¿En qué provincia o zona está esa ciudad?`);
      const selected = chooseLocality(data.results.map((item: any) => ({ latitude: Number(item.geometry?.location?.lat), longitude: Number(item.geometry?.location?.lng), label: item.formatted_address || locality })), locality);
      if (selected) return selected;
    }
  }
  throw new Error(`El mapa no pudo ubicar la ciudad indicada: ${locality}. Podemos volver a consultar o elegir una localidad de esa zona.`);
}

export async function searchNearbyLocations(query: string, userCoords: UserCoords): Promise<LocationSearchResult[]> {
  const intent = destinationSearchIntent(query);
  const center = intent.locality ? await localityCenter(intent.locality) : userCoords;
  let successfulProviders = 0;
  if (mapKey()) {
    try {
      const results = await googlePlaces(intent.text, center, intent.category);
      successfulProviders++;
      if (results.length) return results;
    } catch { /* An unavailable provider must not look like an empty map. */ }
  }
  if (intent.category) {
    try {
      const results = await osmCategoryPlaces(intent.category, center);
      successfulProviders++;
      if (results.length) return results;
    } catch { /* Try the search index as well as the category map. */ }
  }
  try {
    const data = await mapJson(buildSearchUrl(intent.category?.phrase || intent.text, center, true));
    if (!Array.isArray(data)) throw new Error('El mapa no devolvió lugares válidos.');
    successfulProviders++;
    const results = closestPlaces(data.filter(item => item && typeof item.display_name === 'string').map(mapSearchResult), center);
    if (results.length) return results;
  } catch { /* Distinguish a real empty search from a provider failure below. */ }
  if (!successfulProviders) throw new Error('Los servicios de mapas no están respondiendo. Podemos volver a buscar lugares cercanos; no hace falta el nombre exacto.');
  return [];
}

function mapSearchResult(item: any): LocationSearchResult {
  const parts = item.display_name.split(',');
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : parts.length > 2 ? parts.slice(0, 3).join(',').trim() : item.display_name;

  return {
    id: item.place_id.toString(),
    name,
    address: item.display_name,
    latitude: parseFloat(item.lat),
    longitude: parseFloat(item.lon),
  };
}

function rankResults(
  results: LocationSearchResult[],
  userCoords?: UserCoords,
  preferredLocality?: string | null,
) {
  const normalizedPreferredLocality = extractPreferredLocality(preferredLocality);

  return results
    .map((result, index) => {
      const normalizedAddress = normalizeText(result.address);
      const localityBoost =
        normalizedPreferredLocality && normalizedAddress.includes(normalizedPreferredLocality) ? 0 : 1;
      const distanceKm = userCoords
        ? getDistanceInKm(userCoords, { latitude: result.latitude, longitude: result.longitude })
        : Number.POSITIVE_INFINITY;

      return { result, index, localityBoost, distanceKm };
    })
    .sort((a, b) => {
      if (a.localityBoost !== b.localityBoost) {
        return a.localityBoost - b.localityBoost;
      }
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.result);
}

export async function searchLocations(
  query: string,
  options: SearchLocationsOptions = {},
): Promise<LocationSearchResult[]> {
  if (query.trim().length < 3) return [];

  try {
    const response = await fetch(buildSearchUrl(query, options.userCoords), {
      headers: {
        'User-Agent': 'AnnyApp/4.0 (contact@anny.com)',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rankedResults = rankResults(
      data.map(mapSearchResult),
      options.userCoords,
      options.preferredLocality,
    );

    return rankedResults.slice(0, options.limit ?? DEFAULT_RESULTS_LIMIT);
  } catch (error) {
    console.warn('Error fetching from Nominatim:', error);
    return [];
  }
}
