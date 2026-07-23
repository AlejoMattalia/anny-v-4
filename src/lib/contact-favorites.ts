import * as FileSystem from 'expo-file-system/legacy';

const favoritesFile = `${FileSystem.documentDirectory}anny-contact-favorites.json`;

export async function getFavoriteContactNumbers() {
  try {
    const info = await FileSystem.getInfoAsync(favoritesFile);

    if (!info.exists) {
      return [];
    }

    const rawFavorites = await FileSystem.readAsStringAsync(favoritesFile, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const favorites = JSON.parse(rawFavorites) as unknown;

    return Array.isArray(favorites) ? favorites.filter((phoneNumber): phoneNumber is string => typeof phoneNumber === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveFavoriteContactNumbers(phoneNumbers: string[]) {
  await FileSystem.writeAsStringAsync(favoritesFile, JSON.stringify(phoneNumbers), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
