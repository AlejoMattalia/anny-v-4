import { readPersistentValue, writePersistentValue } from './persistent-storage';

const settingsKey = 'anny-settings.json';

export interface AppSettings {
  compassActive: boolean;
  destinationAlertsEnabled: boolean;
  glassesProtocol: 'wifi' | 'bluetooth';
  notificationDistance: number;
  voiceRate: number;
  simulationSpeed: number;
  scanInterval: number;
}

const defaultSettings: AppSettings = {
  compassActive: false,
  destinationAlertsEnabled: true,
  glassesProtocol: 'wifi',
  notificationDistance: 400,
  voiceRate: 1,
  simulationSpeed: 1,
  scanInterval: 30,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const content = await readPersistentValue(settingsKey);
    if (content !== null) {
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
    await writePersistentValue(settingsKey, JSON.stringify(updated));
  } catch {
    // Ignore error
  }
}
