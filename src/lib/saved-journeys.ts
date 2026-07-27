import * as FileSystem from 'expo-file-system/legacy';
import { LocationItem } from './saved-locations';

export interface SavedJourney {
  id: string;
  title: string;
  origin: LocationItem;
  destination: LocationItem;
  travelMode?: 'transit' | 'driving' | 'walking';
  createdAt: string;
}

const journeysFile = `${FileSystem.documentDirectory}anny-saved-journeys.json`;

export async function getSavedJourneys(): Promise<SavedJourney[]> {
  try {
    const info = await FileSystem.getInfoAsync(journeysFile);
    if (!info.exists) {
      return [];
    }

    const rawData = await FileSystem.readAsStringAsync(journeysFile, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? (parsed as SavedJourney[]) : [];
  } catch (error) {
    console.warn('Error al cargar viajes guardados:', error);
    return [];
  }
}

export async function saveSavedJourneys(journeys: SavedJourney[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(journeysFile, JSON.stringify(journeys), {
      encoding: FileSystem.EncodingType.UTF8,
    });
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
