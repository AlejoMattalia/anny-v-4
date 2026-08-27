import { getAuthSession } from '@/lib/auth';

export const streamingApiUrl =
  process.env.EXPO_PUBLIC_STREAMING_API_URL?.replace(/\/$/, '') ?? '';

export type RemoteCamera = {
  id: string;
  name: string;
  enabled: boolean;
  online: boolean;
  createdAt?: string;
};

export type CameraViewSession = {
  streamUrl: string;
  expiresIn: number;
};

export class RemoteCameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteCameraError';
  }
}

async function streamingRequest<T>(path: string, options: RequestInit = {}) {
  if (!streamingApiUrl) {
    throw new RemoteCameraError('Falta configurar el servidor de cámaras.');
  }

  const session = await getAuthSession();
  if (!session?.access_token) {
    throw new RemoteCameraError('Tu sesión expiró. Iniciá sesión nuevamente.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${streamingApiUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...options.headers,
      },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;

    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_activation_code: 'El código de activación no es válido o ya fue utilizado.',
        camera_not_found: 'La cámara no existe o no pertenece a tu cuenta.',
        camera_offline: 'El lente dejó de transmitir.',
        capture_unavailable: 'El servidor no puede capturar imágenes en este momento.',
        capture_failed: 'No se pudo obtener una imagen del lente.',
        unauthorized: 'Tu sesión expiró. Iniciá sesión nuevamente.',
      };
      throw new RemoteCameraError(
        messages[payload?.error ?? ''] ?? payload?.message ?? 'No pudimos completar la operación.',
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof RemoteCameraError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RemoteCameraError('La conexión tardó demasiado. Intentá nuevamente.');
    }
    throw new RemoteCameraError('No pudimos conectar con el servidor de cámaras.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRemoteCameras() {
  const result = await streamingRequest<{ cameras: RemoteCamera[] }>('/cameras');
  return result.cameras ?? [];
}

export async function claimRemoteCamera(activationCode: string) {
  return streamingRequest<{ camera: RemoteCamera; deviceSecret: string }>('/cameras/claim', {
    method: 'POST',
    body: JSON.stringify({ activationCode: activationCode.trim().toUpperCase() }),
  });
}

export async function createCameraViewSession(cameraId: string) {
  return streamingRequest<CameraViewSession>(`/cameras/${encodeURIComponent(cameraId)}/view`, {
    method: 'POST',
  });
}

export async function captureRemoteCamera(cameraId: string) {
  if (!streamingApiUrl) {
    throw new RemoteCameraError('Falta configurar el servidor de cámaras.');
  }
  const session = await getAuthSession();
  if (!session?.access_token) {
    throw new RemoteCameraError('Tu sesión expiró. Iniciá sesión nuevamente.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const captureUrl = `${streamingApiUrl}/cameras/${encodeURIComponent(cameraId)}/capture`;
  const startedAt = Date.now();
  try {
    console.log('[RemoteCameraCapture] starting', { cameraId, captureUrl });
    const response = await fetch(captureUrl, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });
    console.log('[RemoteCameraCapture] response', {
      cameraId,
      contentLength: response.headers.get('content-length'),
      contentType: response.headers.get('content-type'),
      elapsedMs: Date.now() - startedAt,
      status: response.status,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      console.error('[RemoteCameraCapture] server rejected capture', {
        cameraId,
        payload,
        status: response.status,
      });
      const messages: Record<string, string> = {
        camera_not_found: 'La cámara no existe o no pertenece a tu cuenta.',
        camera_offline: 'El lente dejó de transmitir.',
        capture_unavailable: 'El servidor no puede capturar imágenes en este momento.',
        capture_failed: 'No se pudo obtener una imagen del lente.',
      };
      throw new RemoteCameraError(
        messages[payload?.error ?? ''] ?? `No se pudo capturar la imagen (${response.status}).`,
      );
    }
    const imageBytes = new Uint8Array(await response.arrayBuffer());
    console.log('[RemoteCameraCapture] image bytes received', {
      cameraId,
      size: imageBytes.length,
      type: response.headers.get('content-type'),
    });
    const dataUrl = bytesToDataUrl(imageBytes, response.headers.get('content-type'));
    console.log('[RemoteCameraCapture] data URL ready', {
      cameraId,
      characters: dataUrl.length,
      elapsedMs: Date.now() - startedAt,
    });
    return dataUrl;
  } catch (error) {
    console.error('[RemoteCameraCapture] failed', {
      cameraId,
      elapsedMs: Date.now() - startedAt,
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
    });
    if (error instanceof RemoteCameraError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RemoteCameraError('La captura del lente tardó demasiado.');
    }
    throw new RemoteCameraError('No pudimos obtener una imagen del lente.');
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string | null) {
  if (!bytes.length) throw new RemoteCameraError('La imagen del lente está vacía.');
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const mimeType = contentType?.startsWith('image/') ? contentType : 'image/jpeg';
  return `data:${mimeType};base64,${globalThis.btoa(binary)}`;
}
