import { readPersistentValue, writePersistentValue } from './persistent-storage';

const favoritesKey = 'anny-contact-favorites.json';

export async function getFavoriteContactNumbers() {
  try {
    const rawFavorites = await readPersistentValue(favoritesKey);
    if (rawFavorites === null) {
      return [];
    }

    const favorites = JSON.parse(rawFavorites) as unknown;

    return Array.isArray(favorites) ? favorites.filter((phoneNumber): phoneNumber is string => typeof phoneNumber === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveFavoriteContactNumbers(phoneNumbers: string[]) {
  await writePersistentValue(favoritesKey, JSON.stringify(phoneNumbers));
}
