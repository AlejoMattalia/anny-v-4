import * as FileSystem from 'expo-file-system/legacy';

const settingsFile = `${FileSystem.documentDirectory}anny-settings.json`;

export interface AppSettings {
  compassActive: boolean;
  glassesProtocol: 'wifi' | 'bluetooth';
  voiceRate: number;
  simulationSpeed: number;
}

const defaultSettings: AppSettings = {
  compassActive: false,
  glassesProtocol: 'bluetooth',
  voiceRate: 1,
  simulationSpeed: 1,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const info = await FileSystem.getInfoAsync(settingsFile);
    if (info.exists) {
      const content = await FileSystem.readAsStringAsync(settingsFile);
      return { ...defaultSettings, ...JSON.parse(content) };
    }
  } catch {
    // Ignore error and return defaults
  }
  return defaultSettings;
}

export async function saveSettings(settings: Partial<AppSettings>) {
  try {
    const current = await loadSettings();
    const updated = { ...current, ...settings };
    await FileSystem.writeAsStringAsync(settingsFile, JSON.stringify(updated), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    // Ignore error
  }
}
