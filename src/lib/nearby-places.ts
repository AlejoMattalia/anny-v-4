import Constants from 'expo-constants';
import { fetchMapJson } from './map-request';

export interface NearbyPlace {
  id: string;
  name: string;
  address: string;
  category: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

const SEARCH_RADIUS_METERS = 1500;
const MAX_RESULTS = 30;
const googleMapKey = () =>
  process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY?.trim() ||
  (typeof Constants.expoConfig?.extra?.googleMapKey === 'string'
    ? Constants.expoConfig.extra.googleMapKey.trim()
    : '');

function distanceInMeters(from: Coordinates, to: Coordinates) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeGoogleCategory(types: string[] | undefined) {
  const type = types?.find((item) => item !== 'point_of_interest' && item !== 'establishment');
  return type ? type.replaceAll('_', ' ') : 'Lugar';
}

async function searchGooglePlaces(origin: Coordinates): Promise<NearbyPlace[]> {
  const GOOGLE_MAP_KEY = googleMapKey();
  if (!GOOGLE_MAP_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    key: GOOGLE_MAP_KEY,
    location: `${origin.latitude},${origin.longitude}`,
    radius: SEARCH_RADIUS_METERS.toString(),
    language: 'es',
  });
  const payload = await fetchMapJson(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`);
  if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
    throw new Error(payload.error_message || `Google Places: ${payload.status}`);
  }

  return (payload.results ?? [])
    .filter((place: any) => place.types?.some((type: string) => ['point_of_interest', 'establishment', 'park'].includes(type)))
    .map((place: any) => {
      const latitude = Number(place.geometry?.location?.lat);
      const longitude = Number(place.geometry?.location?.lng);

      return {
        id: String(place.place_id),
        name: place.name || 'Lugar sin nombre',
        address: place.vicinity || 'Dirección no disponible',
        category: normalizeGoogleCategory(place.types),
        latitude,
        longitude,
        distanceMeters: Math.round(
          distanceInMeters(origin, { latitude, longitude }),
        ),
      };
    })
    .filter(
      (place: NearbyPlace) =>
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && place.distanceMeters <= SEARCH_RADIUS_METERS,
    );
}

function getOverpassCategory(tags: Record<string, string>) {
  const value =
    tags.amenity ||
    tags.shop ||
    tags.tourism ||
    tags.leisure ||
    tags.healthcare ||
    tags.public_transport;
  return value ? value.replaceAll('_', ' ') : 'Lugar';
}

function getOverpassAddress(tags: Record<string, string>) {
  const street = [tags['addr:street'], tags['addr:housenumber']]
    .filter(Boolean)
    .join(' ');
  return (
    [street, tags['addr:city']].filter(Boolean).join(', ') ||
    tags['addr:full'] ||
    'Dirección no disponible'
  );
}

async function searchOpenStreetMap(origin: Coordinates): Promise<NearbyPlace[]> {
  const query = `
    [out:json][timeout:20];
    (
      nwr(around:${SEARCH_RADIUS_METERS},${origin.latitude},${origin.longitude})[name][amenity];
      nwr(around:${SEARCH_RADIUS_METERS},${origin.latitude},${origin.longitude})[name][shop];
      nwr(around:${SEARCH_RADIUS_METERS},${origin.latitude},${origin.longitude})[name][tourism];
      nwr(around:${SEARCH_RADIUS_METERS},${origin.latitude},${origin.longitude})[name][healthcare];
      nwr(around:${SEARCH_RADIUS_METERS},${origin.latitude},${origin.longitude})[name][public_transport];
    );
    out center;
  `;
  const payload = await fetchMapJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, 22000);
  return (payload.elements ?? [])
    .map((place: any) => {
      const latitude = Number(place.lat ?? place.center?.lat);
      const longitude = Number(place.lon ?? place.center?.lon);
      const tags = (place.tags ?? {}) as Record<string, string>;
      return {
        id: `osm-${place.type}-${place.id}`,
        name: tags.name || 'Lugar sin nombre',
        address: getOverpassAddress(tags),
        category: getOverpassCategory(tags),
        latitude,
        longitude,
        distanceMeters: Math.round(
          distanceInMeters(origin, { latitude, longitude }),
        ),
      };
    })
    .filter(
      (place: NearbyPlace) =>
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude),
    );
}

async function loadNearbyPlaces(origin: Coordinates) {
  let places: NearbyPlace[] = [];

  try {
    places = await searchGooglePlaces(origin);
  } catch (error) {
    console.warn('Google Places no estuvo disponible:', error);
  }

  if (places.length === 0) {
    places = await searchOpenStreetMap(origin);
  }

  return places
    .filter(place => Number.isFinite(place.distanceMeters) && place.distanceMeters <= SEARCH_RADIUS_METERS)
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .slice(0, MAX_RESULTS);
}

let cache: { origin: Coordinates; loadedAt: number; places: NearbyPlace[] } | null = null;
const pending = new Map<string, Promise<NearbyPlace[]>>();
export async function getNearbyPlaces(origin: Coordinates, forceRefresh = false): Promise<NearbyPlace[]> {
  if (!forceRefresh && cache && Date.now() - cache.loadedAt < 30000 && distanceInMeters(origin, cache.origin) < 50) return cache.places;
  const key = `${origin.latitude},${origin.longitude}`;
  if (pending.has(key)) return pending.get(key)!;
  const request = loadNearbyPlaces(origin).then(places => {
    cache = { origin: { ...origin }, places, loadedAt: Date.now() };
    return places;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function isGeneralNearbyQuery(query = '') {
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,]/g, '').trim();
  const genericWords = new Set('que cuales hay buscar busca mostrame mostrar ver los las unos unas todos todas de a mi mis en por aca aqui alrededor cerca cercanos cercanas proximos proximas lugares comercios servicios sitios negocios y estoy donde ubicacion actual del la el zona esta alrededores'.split(' '));
  return !normalized || normalized.split(/\s+/).every(word => genericWords.has(word));
}
