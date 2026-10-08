import * as Location from 'expo-location';

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
): Promise<CurrentLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
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

    const cached = await Location.getLastKnownPositionAsync({
      maxAge: maxCachedAgeMs,
      requiredAccuracy: maxCachedAccuracyMeters,
    });

    if (cached) {
      cachedLocation = toCurrentLocation(cached);
      return cachedLocation;
    }
  }

  const current = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
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
}): Promise<CurrentLocation> {
  const allowCached = options?.allowCached ?? true;
  const maxCachedAgeMs = options?.maxCachedAgeMs ?? MAX_CACHED_LOCATION_AGE_MS;
  const maxCachedAccuracyMeters = options?.maxCachedAccuracyMeters ?? MAX_CACHED_LOCATION_ACCURACY_METERS;
  const key = allowCached ? `${maxCachedAgeMs}:${maxCachedAccuracyMeters}` : 'fresh';
  const pending = pendingLocations.get(key);
  if (pending) return pending;

  const request = locate(allowCached, maxCachedAgeMs, maxCachedAccuracyMeters).finally(() => {
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

  return address.formattedAddress || parts.join(', ');
}

export async function reverseGeocodeLocation(
  location: Pick<CurrentLocation, 'latitude' | 'longitude'>,
) {
  const coordinates = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  try {
    const [address] = await Location.reverseGeocodeAsync(location);
    if (!address) {
      return coordinates;
    }

    return formatGeocodedAddress(address) || coordinates;
  } catch {
    return coordinates;
  }
}
