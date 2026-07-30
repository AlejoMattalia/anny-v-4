import { readPersistentValue, writePersistentValue } from './persistent-storage';

export interface LocationItem {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

const locationsKey = 'anny-saved-locations.json';

const defaultLocations: LocationItem[] = [
  {
    id: '1',
    name: 'Casa',
    address: 'Córdoba 1500, Rosario, Santa Fe',
    latitude: -32.94682,
    longitude: -60.64747,
  },
  {
    id: '2',
    name: 'Trabajo',
    address: 'Av. Pellegrini 1200, Rosario, Santa Fe',
    latitude: -32.95462,
    longitude: -60.64379,
  },
  {
    id: '3',
    name: 'Terminal de Ómnibus',
    address: 'Cafferata 702, Rosario, Santa Fe',
    latitude: -32.93722,
    longitude: -60.66989,
  },
  {
    id: '4',
    name: 'Monumento a la Bandera',
    address: 'Parque Nacional a la Bandera, Rosario, Santa Fe',
    latitude: -32.94768,
    longitude: -60.63047,
  },
];

export async function getSavedLocations(): Promise<LocationItem[]> {
  try {
    const rawData = await readPersistentValue(locationsKey);
    if (rawData === null) {
      // Save default locations on first load
      await saveSavedLocations(defaultLocations);
      return defaultLocations;
    }

    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? (parsed as LocationItem[]) : defaultLocations;
  } catch (error) {
    console.warn('Error al cargar ubicaciones guardadas:', error);
    return defaultLocations;
  }
}

export async function saveSavedLocations(locations: LocationItem[]): Promise<void> {
  try {
    await writePersistentValue(locationsKey, JSON.stringify(locations));
  } catch (error) {
    console.error('Error al guardar ubicaciones:', error);
  }
}
