import Constants from 'expo-constants';

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
const GOOGLE_MAP_KEY =
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
  if (!GOOGLE_MAP_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    key: GOOGLE_MAP_KEY,
    location: `${origin.latitude},${origin.longitude}`,
    radius: SEARCH_RADIUS_METERS.toString(),
    language: 'es',
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Google Places respondió ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') {
    throw new Error(payload.error_message || `Google Places: ${payload.status}`);
  }

  return (payload.results ?? [])
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
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude),
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
    out center ${MAX_RESULTS};
  `;
  const response = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
    {
      headers: {
        'User-Agent': 'AnnyApp/4.0 (contact@anny.com)',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`OpenStreetMap respondió ${response.status}.`);
  }

  const payload = await response.json();
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

export async function getNearbyPlaces(origin: Coordinates) {
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
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .slice(0, MAX_RESULTS);
}
