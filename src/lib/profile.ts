import { appApiUrl } from '@/lib/api';
import { getAuthSession, saveAuthSession, type AuthUser } from '@/lib/auth';

const requestTimeoutMs = 10000;

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const data = payload as { message?: unknown; error?: { message?: unknown } };
  const message = data.error?.message ?? data.message;

  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === 'string').join('\n') || fallback;
  }

  return typeof message === 'string' ? message : fallback;
}

async function authenticatedRequest<T>(path: string, options: RequestInit = {}) {
  if (!appApiUrl) {
    throw new ProfileError('No está configurada la URL de la API.');
  }

  const session = await getAuthSession();

  if (!session?.access_token) {
    throw new ProfileError('Tu sesión expiró. Iniciá sesión nuevamente.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${appApiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new ProfileError(getErrorMessage(payload, 'No pudimos completar la operación.'));
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ProfileError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProfileError('La conexión tardó demasiado. Intentá nuevamente.');
    }

    throw new ProfileError('No pudimos conectar con el servidor.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function getProfileUser() {
  const session = await getAuthSession();

  try {
    const user = await authenticatedRequest<AuthUser>('/api/user/self');
    if (session) {
      await saveAuthSession({ ...session, user });
    }
    return user;
  } catch {
    return session?.user ?? null;
  }
}

export async function updateProfileUser(profile: { name: string; phone?: string }) {
  const session = await getAuthSession();
  const user = await authenticatedRequest<AuthUser>('/api/user/self', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });

  if (session) {
    await saveAuthSession({ ...session, user: { ...session.user, ...user } });
  }

  return user;
}

export async function changeProfilePassword(passwords: {
  currentPassword: string;
  password: string;
  confirmPassword: string;
}) {
  await authenticatedRequest('/api/user/self/password', {
    method: 'PUT',
    body: JSON.stringify(passwords),
  });
}
