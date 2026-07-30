import { readPersistentValue, writePersistentValue } from './persistent-storage';

const onboardingSeenKey = 'anny-onboarding-seen.json';

export async function hasSeenOnboarding() {
  try {
    return (await readPersistentValue(onboardingSeenKey)) !== null;
  } catch {
    return false;
  }
}

export async function markOnboardingSeen() {
  await writePersistentValue(onboardingSeenKey, JSON.stringify({ seen: true }));
}
