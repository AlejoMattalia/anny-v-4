import { LocationItem } from './saved-locations';
import { readPersistentValue, writePersistentValue } from './persistent-storage';

export interface SavedJourney {
  id: string;
  title: string;
  origin: LocationItem;
  destination: LocationItem;
  travelMode?: 'transit' | 'driving' | 'walking';
  createdAt: string;
}

const journeysKey = 'anny-saved-journeys.json';

export async function getSavedJourneys(): Promise<SavedJourney[]> {
  try {
    const rawData = await readPersistentValue(journeysKey);
    if (rawData === null) {
      return [];
    }

    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? (parsed as SavedJourney[]) : [];
  } catch (error) {
    console.warn('Error al cargar viajes guardados:', error);
    return [];
  }
}

export async function saveSavedJourneys(journeys: SavedJourney[]): Promise<void> {
  try {
    await writePersistentValue(journeysKey, JSON.stringify(journeys));
  } catch (error) {
    console.error('Error al guardar viajes:', error);
  }
}

export async function addSavedJourney(
  origin: LocationItem,
  destination: LocationItem,
  customTitle?: string,
  travelMode: 'transit' | 'driving' | 'walking' = 'walking',
): Promise<SavedJourney[]> {
  const journeys = await getSavedJourneys();
  const title = customTitle || `De ${origin.name} a ${destination.name}`;
  const newJourney: SavedJourney = {
    id: Date.now().toString(),
    title,
    origin: { ...origin },
    destination: { ...destination },
    travelMode,
    createdAt: new Date().toISOString(),
  };

  const updated = [newJourney, ...journeys];
  await saveSavedJourneys(updated);
  return updated;
}

export async function deleteSavedJourney(id: string): Promise<SavedJourney[]> {
  const journeys = await getSavedJourneys();
  const filtered = journeys.filter((j) => j.id !== id);
  await saveSavedJourneys(filtered);
  return filtered;
}
