export const appApiUrl = process.env.EXPO_PUBLIC_APP_API_URL?.replace(/\/$/, '') ?? '';

export type OnboardingStep = {
  _id?: string;
  image?: string;
  content?: {
    es?: string;
    en?: string;
    [key: string]: string | undefined;
  };
  position?: number;
};

type OnboardingResponse = {
  docs?: OnboardingStep[];
};

type PreferenceResponse = {
  docs?: {
    updatedAt?: string | number;
    termsConditions?: {
      es?: string;
      en?: string;
      [key: string]: string | undefined;
    };
  }[];
};

export async function getJson<T>(path: string): Promise<T> {
  if (!appApiUrl) {
    throw new Error('EXPO_PUBLIC_APP_API_URL is not configured');
  }

  const response = await fetch(`${appApiUrl}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getOnboardingSteps() {
  const data = await getJson<OnboardingResponse>('/api/onboarding');
  return [...(data.docs ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function getTermsOfUse() {
  const data = await getJson<PreferenceResponse>('/api/preference');
  const docs = [...(data.docs ?? [])].sort((a, b) => {
    const firstDate = new Date(a.updatedAt ?? 0).getTime();
    const secondDate = new Date(b.updatedAt ?? 0).getTime();
    return secondDate - firstDate;
  });

  return docs[0]?.termsConditions?.es ?? '';
}
