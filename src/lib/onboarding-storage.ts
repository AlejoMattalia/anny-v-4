import * as FileSystem from 'expo-file-system/legacy';

const onboardingSeenFile = `${FileSystem.documentDirectory}anny-onboarding-seen.json`;

export async function hasSeenOnboarding() {
  try {
    const info = await FileSystem.getInfoAsync(onboardingSeenFile);
    return info.exists;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen() {
  await FileSystem.writeAsStringAsync(onboardingSeenFile, JSON.stringify({ seen: true }), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
