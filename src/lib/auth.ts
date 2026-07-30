import { appApiUrl } from '@/lib/api';
import {
  deletePersistentValue,
  readPersistentValue,
  writePersistentValue,
} from '@/lib/persistent-storage';

const authSessionKey = 'anny-auth-session.json';
const requestTimeoutMs = 10000;

export type AuthUser = {
  _id?: string;
  email?: string;
  name?: string;
  lastName?: string;
  status?: string;
  roles?: { name?: string }[];
  [key: string]: unknown;
};

export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  user?: AuthUser;
  [key: string]: unknown;
};

export class LoginError extends Error {
  constructor(
    message: string,
    public readonly code?: number | string,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

const backendMessages: Record<string, string> = {
  'login.error.invalidEmail': 'El correo electrónico no está registrado.',
  'login.error.invalidPassword': 'La contraseña es incorrecta.',
  'login.error.incorrectPassword': 'La contraseña es incorrecta.',
  'login.error.invalidCredentials': 'El correo o la contraseña son incorrectos.',
  'auth.error.unauthorized': 'El correo o la contraseña son incorrectos.',
  'Unauthorized': 'El correo o la contraseña son incorrectos.',
};

function translateBackendMessage(message: unknown): string {
  if (Array.isArray(message)) {
    return message.map(translateBackendMessage).filter(Boolean).join('\n');
  }

  if (typeof message !== 'string') {
    return '';
  }

  return backendMessages[message] ?? message;
}

function getResponseErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const data = payload as {
    error?: { message?: unknown; code?: number | string };
    message?: unknown;
  };

  return translateBackendMessage(data.error?.message) || translateBackendMessage(data.message) || fallback;
}

function getResponseErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  return (payload as { error?: { code?: number | string }; statusCode?: number | string }).error?.code;
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

export async function loginWithEmail(email: string, password: string) {
  if (!appApiUrl) {
    throw new LoginError('No está configurada la URL de la API.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${appApiUrl}/api/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new LoginError(
        getResponseErrorMessage(payload, 'No pudimos iniciar sesión. Revisá tus datos e intentá de nuevo.'),
        getResponseErrorCode(payload) ?? response.status,
      );
    }

    const session = payload as AuthSession;

    if (!session?.access_token) {
      throw new LoginError('El servidor no devolvió una sesión válida.');
    }

    await saveAuthSession(session);
    return session;
  } catch (error) {
    if (error instanceof LoginError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new LoginError('La conexión tardó demasiado. Intentá nuevamente.');
    }

    throw new LoginError('No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveAuthSession(session: AuthSession) {
  await writePersistentValue(authSessionKey, JSON.stringify(session));
}

export async function getAuthSession() {
  try {
    const rawSession = await readPersistentValue(authSessionKey);
    if (rawSession === null) {
      return null;
    }

    const session = JSON.parse(rawSession) as AuthSession;

    return session.access_token ? session : null;
  } catch {
    return null;
  }
}

export async function clearAuthSession() {
  try {
    await deletePersistentValue(authSessionKey);
  } catch {
    // Nothing to clear.
  }
}
