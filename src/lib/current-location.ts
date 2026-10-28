import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { fetchMapJson, mapDeadline } from './map-request';

export interface CurrentLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}

const MAX_CACHED_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;

let cachedLocation: CurrentLocation | null = null;
const pendingLocations = new Map<string, Promise<CurrentLocation>>();

function toCurrentLocation(location: Location.LocationObject): CurrentLocation {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
  };
}

async function locate(
  allowCached: boolean,
  maxCachedAgeMs: number,
  maxCachedAccuracyMeters: number,
  highAccuracy: boolean,
): Promise<CurrentLocation> {
  const currentPermission = await Location.getForegroundPermissionsAsync();
  const permission = currentPermission.status === Location.PermissionStatus.GRANTED ? currentPermission : await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new Error(
      'No hay permiso de ubicación. Podés habilitarlo desde la configuración del teléfono.',
    );
  }

  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new Error('La ubicación del teléfono está apagada.');
  }

  if (allowCached) {
    if (cachedLocation &&
        Date.now() - cachedLocation.timestamp >= 0 &&
        Date.now() - cachedLocation.timestamp <= maxCachedAgeMs &&
        cachedLocation.accuracy != null &&
        cachedLocation.accuracy <= maxCachedAccuracyMeters) {
      return cachedLocation;
    }

    const cached = await mapDeadline(Location.getLastKnownPositionAsync({
      maxAge: maxCachedAgeMs,
      requiredAccuracy: maxCachedAccuracyMeters,
    }), 2000).catch(() => null);

    if (cached) {
      cachedLocation = toCurrentLocation(cached);
      return cachedLocation;
    }
  }

  const current = await Location.getCurrentPositionAsync({
    accuracy: highAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced,
    mayShowUserSettingsDialog: true,
  });

  cachedLocation = toCurrentLocation(current);
  return cachedLocation;
}

export async function warmCurrentLocation() {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === Location.PermissionStatus.GRANTED) {
      await getCurrentLocation({ allowCached: false });
    }
  } catch {
    // La app sigue funcionando aunque la ubicación no esté disponible al abrirla.
  }
}

export async function getCurrentLocation(options?: {
  allowCached?: boolean;
  maxCachedAgeMs?: number;
  maxCachedAccuracyMeters?: number;
  highAccuracy?: boolean;
}): Promise<CurrentLocation> {
  const allowCached = options?.allowCached ?? true;
  const maxCachedAgeMs = options?.maxCachedAgeMs ?? MAX_CACHED_LOCATION_AGE_MS;
  const maxCachedAccuracyMeters = options?.maxCachedAccuracyMeters ?? MAX_CACHED_LOCATION_ACCURACY_METERS;
  const highAccuracy = options?.highAccuracy ?? false;
  const key = `${allowCached ? `${maxCachedAgeMs}:${maxCachedAccuracyMeters}` : 'fresh'}:${highAccuracy}`;
  const pending = pendingLocations.get(key);
  if (pending) return pending;

  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('No pudimos obtener tu ubicación. Revisá que el GPS esté encendido e intentá nuevamente.')), 20000);
  });
  const request = Promise.race([locate(allowCached, maxCachedAgeMs, maxCachedAccuracyMeters, highAccuracy), deadline]).finally(() => {
    clearTimeout(timeout);
    pendingLocations.delete(key);
  });
  pendingLocations.set(key, request);
  return request;
}

export function formatGeocodedAddress(
  address: Location.LocationGeocodedAddress,
) {
  const street = [address.street, address.streetNumber].filter(Boolean).join(' ');
  const parts = [
    street,
    address.district,
    address.city,
    address.subregion,
    address.region,
    address.country,
  ].filter(
    (part, index, allParts): part is string =>
      Boolean(part) && allParts.indexOf(part) === index,
  );

  return street ? parts.join(', ') : address.formattedAddress || parts.join(', ');
}

export async function reverseGeocodeLocation(
  location: Pick<CurrentLocation, 'latitude' | 'longitude'>,
) {
  const coordinates = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  let approximateAddress = '';
  try {
    const [address] = await mapDeadline(Location.reverseGeocodeAsync(location), 4000);
    if (address?.street) return formatGeocodedAddress(address);
    if (address) approximateAddress = formatGeocodedAddress(address);
  } catch { /* Some Android devices have no working native geocoder. */ }
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY?.trim() || Constants.expoConfig?.extra?.googleMapKey;
  if (key) try {
    const params = new URLSearchParams({ latlng: `${location.latitude},${location.longitude}`, language: 'es', key: String(key) });
    const data = await fetchMapJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const address = data.results?.find((item: any) => item.address_components?.some((part: any) => part.types?.includes('route')));
    if (data.status === 'OK' && address?.formatted_address) return address.formatted_address as string;
  } catch { /* Try the open map before giving up on the address. */ }
  try {
    const params = new URLSearchParams({ format: 'jsonv2', lat: String(location.latitude), lon: String(location.longitude), zoom: '18', 'accept-language': 'es' });
    const data = await fetchMapJson(`https://nominatim.openstreetmap.org/reverse?${params}`);
    const address = data.address;
    const street = address?.road || address?.pedestrian || address?.footway || address?.residential;
    if (street) return [street, address.house_number, address.suburb, address.city || address.town || address.village].filter(Boolean).join(', ');
  } catch { /* Coordinates remain available without internet. */ }
  return approximateAddress ? `${approximateAddress}. No pude determinar la calle. Coordenadas: ${coordinates}` : `No pude determinar la dirección. Coordenadas: ${coordinates}`;
}

// Exploration can report an approximate fix with its measured accuracy. Route
// selection keeps the stricter GPS checks in ConversationLocation.
export function getExplorationLocation(forceRefresh = false) {
  return getCurrentLocation({ allowCached: !forceRefresh, highAccuracy: true, maxCachedAgeMs: 30000, maxCachedAccuracyMeters: 100 });
}
