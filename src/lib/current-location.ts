import * as Location from 'expo-location';

export interface CurrentLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}

const MAX_CACHED_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_CACHED_LOCATION_ACCURACY_METERS = 250;

let pendingLocation: Promise<CurrentLocation> | null = null;

function toCurrentLocation(location: Location.LocationObject): CurrentLocation {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp,
  };
}

async function locate(allowCached: boolean): Promise<CurrentLocation> {
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
    const cached = await Location.getLastKnownPositionAsync({
      maxAge: MAX_CACHED_LOCATION_AGE_MS,
      requiredAccuracy: MAX_CACHED_LOCATION_ACCURACY_METERS,
    });

    if (cached) {
      return toCurrentLocation(cached);
    }
  }

  const current = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
    mayShowUserSettingsDialog: true,
  });

  return toCurrentLocation(current);
}

export async function getCurrentLocation(options?: {
  allowCached?: boolean;
}): Promise<CurrentLocation> {
  if (pendingLocation) {
    return pendingLocation;
  }

  pendingLocation = locate(options?.allowCached ?? true).finally(() => {
    pendingLocation = null;
  });

  return pendingLocation;
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
  const [address] = await Location.reverseGeocodeAsync(location);
  if (!address) {
    return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  }

  return (
    formatGeocodedAddress(address) ||
    `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
  );
}
