import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

function getNativeFileUri(key: string) {
  if (!FileSystem.documentDirectory) {
    throw new Error('El almacenamiento de archivos no está disponible.');
  }

  return `${FileSystem.documentDirectory}${key}`;
}

function getWebStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export async function readPersistentValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return getWebStorage()?.getItem(key) ?? null;
  }

  const fileUri = getNativeFileUri(key);
  const info = await FileSystem.getInfoAsync(fileUri);

  if (!info.exists) {
    return null;
  }

  return FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function writePersistentValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(key, value);
    return;
  }

  await FileSystem.writeAsStringAsync(getNativeFileUri(key), value, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function deletePersistentValue(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(key);
    return;
  }

  await FileSystem.deleteAsync(getNativeFileUri(key), { idempotent: true });
}
