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
}

interface SearchLocationsOptions {
  userCoords?: UserCoords;
  preferredLocality?: string | null;
  limit?: number;
}

const DEFAULT_RESULTS_LIMIT = 5;
const NOMINATIM_FETCH_LIMIT = 10;

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

function getDistanceInKm(from: UserCoords, to: UserCoords) {
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

function buildSearchUrl(query: string, userCoords?: UserCoords) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: NOMINATIM_FETCH_LIMIT.toString(),
    addressdetails: '1',
    'accept-language': 'es',
    countrycodes: 'ar',
  });

  if (userCoords) {
    const limit = 0.45;
    const minLon = userCoords.longitude - limit;
    const maxLon = userCoords.longitude + limit;
    const minLat = userCoords.latitude - limit;
    const maxLat = userCoords.latitude + limit;

    params.set('viewbox', `${minLon},${maxLat},${maxLon},${minLat}`);
    params.set('lat', userCoords.latitude.toString());
    params.set('lon', userCoords.longitude.toString());
  }

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

function mapSearchResult(item: any): LocationSearchResult {
  const parts = item.display_name.split(',');
  const name = parts.length > 2 ? parts.slice(0, 3).join(',').trim() : item.display_name;

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
