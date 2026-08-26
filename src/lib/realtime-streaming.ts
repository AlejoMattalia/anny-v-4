import {
  getConnectedAnnyGlasses,
  writeGlassesCommand,
} from '@/lib/bluetooth-glasses';
import { getActiveGlassesNetwork } from '@/lib/glasses-networks';

export const glassesStreamingApiUrl =
  process.env.EXPO_PUBLIC_APP_API_URL_GLASSES?.replace(/\/$/, '') ?? '';

export const realtimeAiUrl =
  process.env.EXPO_PUBLIC_REALTIME_AI_URL?.replace(/\/$/, '') ?? '';

export type GlassesStreamingSession = {
  code: string;
  deviceId: string;
  port: number;
};

type SceneAnalysisResponse = {
  description?: string;
  error?: string;
  tts?: string;
};

type StartStreamingResponse = {
  message?: string;
  port?: number;
  reservation_code?: string;
  status?: boolean;
};

export async function startGlassesStreaming(): Promise<GlassesStreamingSession> {
  if (!glassesStreamingApiUrl) {
    throw new Error('Falta configurar el servidor de streaming de los lentes.');
  }

  const device = await getConnectedAnnyGlasses();
  if (!device) {
    throw new Error('Conectá los lentes Anny por Bluetooth para usar su cámara.');
  }

  const network = await getActiveGlassesNetwork();
  if (!network || network.deviceId !== device.id) {
    throw new Error('Conectá los lentes a WiFi o Hotspot antes de iniciar el streaming.');
  }

  const response = await fetchWithTimeout(
    `${glassesStreamingApiUrl}/start_streaming_listening`,
    {
      body: JSON.stringify({ show_detection: false }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
    10000,
  );

  if (!response.ok) {
    throw new Error(`El servidor de lentes no respondió (${response.status}).`);
  }

  const data = (await response.json()) as StartStreamingResponse;
  const port = Number(data.port);
  const code = data.reservation_code?.trim() ?? '';

  if (!data.status || !Number.isInteger(port) || port <= 0 || !code) {
    throw new Error(data.message || 'No se pudo reservar el streaming de los lentes.');
  }

  try {
    const host = new URL(glassesStreamingApiUrl).hostname;
    await writeGlassesCommand(device.id, '<stop_stream');
    await wait(500);
    await writeGlassesCommand(device.id, `<start_stream:${host}:${port}`);
    await writeGlassesCommand(device.id, '<resolution:1');
  } catch (error) {
    await releaseStreamingReservation(port, code);
    throw error;
  }

  return { code, deviceId: device.id, port };
}

export async function stopGlassesStreaming(
  session: GlassesStreamingSession | null,
) {
  if (!session) return;

  await Promise.allSettled([
    writeGlassesCommand(session.deviceId, '<stop_stream'),
    releaseStreamingReservation(session.port, session.code),
  ]);
}

export function getGlassesVideoUrl(session: GlassesStreamingSession) {
  return `${glassesStreamingApiUrl}/video_feed/${session.port}/${session.code}`;
}

export function getGlassesCaptureUrl(session: GlassesStreamingSession) {
  return `${glassesStreamingApiUrl}/capture/${session.port}/${session.code}`;
}

export async function checkRealtimeAiHealth() {
  if (!realtimeAiUrl) return false;
  try {
    const response = await fetchWithTimeout(`${realtimeAiUrl}/health`, {}, 8000);
    return response.ok;
  } catch {
    return false;
  }
}

export async function analyzeRealtimeImage(imageDataUrl: string, query?: string) {
  if (!realtimeAiUrl) {
    throw new Error('Falta configurar el servidor de inteligencia artificial.');
  }

  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/s);
  if (!match) throw new Error('El formato de la imagen no es válido.');

  const contentType = match[1];
  const imageBytes = decodeBase64(match[2]);
  const boundary = `anny-frame-${Date.now().toString(16)}`;
  const mode = query && /peligro|segur|riesgo|obstáculo/i.test(query)
    ? 'seguridad'
    : 'general';
  const prefix = encodeUtf8(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="frame.${contentType === 'image/png' ? 'png' : 'jpg'}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const fields = encodeUtf8(
    `\r\n--${boundary}\r\n` +
      'Content-Disposition: form-data; name="lang"\r\n\r\n' +
      'es\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="mode"\r\n\r\n' +
      `${mode}\r\n` +
      `--${boundary}--\r\n`,
  );
  const body = new Uint8Array(prefix.length + imageBytes.length + fields.length);
  body.set(prefix, 0);
  body.set(imageBytes, prefix.length);
  body.set(fields, prefix.length + imageBytes.length);

  const response = await fetchWithTimeout(
    `${realtimeAiUrl}/v1/images/describe`,
    {
      body: body.buffer,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
    },
    35000,
  );
  const data = (await response.json()) as SceneAnalysisResponse;
  if (!response.ok) {
    throw new Error(data.error || `El servicio de visión respondió ${response.status}.`);
  }

  const text = data.tts?.trim() || data.description?.trim();
  if (!text) throw new Error('El servicio de visión no devolvió una descripción.');
  return text;
}

async function releaseStreamingReservation(port: number, code: string) {
  if (!glassesStreamingApiUrl) return;

  try {
    await fetchWithTimeout(
      `${glassesStreamingApiUrl}/stop_streaming_listening`,
      {
        body: JSON.stringify({ port, code }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      6000,
    );
  } catch {
    // The Bluetooth stop command still closes the stream on the glasses.
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
