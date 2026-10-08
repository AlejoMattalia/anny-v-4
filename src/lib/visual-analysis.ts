export type VisualAnalysisMode =
  | 'describe_scene'
  | 'identify_currency'
  | 'read_text';

type VisualAnalysisResponse = {
  denomination?: number | string;
  description?: string;
  error?: string;
  readingOrder?: string;
  text?: string | { fullText?: string };
  tts?: string;
};

const configuredVisualAiUrl =
  process.env.EXPO_PUBLIC_APP_API_IA_URL ??
  process.env.EXPO_PUBLIC_REALTIME_AI_URL ??
  'http://vision-ai-service-env.eba-jfqhpms9.us-east-2.elasticbeanstalk.com';

export const visualAiUrl = configuredVisualAiUrl.replace(/\/$/, '');

// anny-app-v3 uses this service specifically for OCR because the production
// Elastic Beanstalk service only exposes the image-description endpoint.
const ocrAiUrl = (
  process.env.EXPO_PUBLIC_OCR_AI_URL ?? 'http://3.15.63.191'
).replace(/\/$/, '');

export async function analyzeVisualImage(
  imageDataUrl: string,
  mode: VisualAnalysisMode,
) {
  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/s);
  if (!match) throw new Error('El formato de la imagen no es válido.');

  const contentType = match[1];
  const imageBytes = decodeBase64(match[2]);
  const boundary = `anny-visual-${Date.now().toString(16)}`;
  const prefix = encodeUtf8(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="image.${contentType === 'image/png' ? 'png' : 'jpg'}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const fields = encodeUtf8(
    `\r\n--${boundary}\r\n` +
      'Content-Disposition: form-data; name="lang"\r\n\r\n' +
      'es\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="mode"\r\n\r\n' +
      'general\r\n' +
      `--${boundary}--\r\n`,
  );
  const body = new Uint8Array(prefix.length + imageBytes.length + fields.length);
  body.set(prefix, 0);
  body.set(imageBytes, prefix.length);
  body.set(fields, prefix.length + imageBytes.length);

  const endpoint = mode === 'read_text' ? '/v1/images/ocr' : '/v1/images/describe';
  const serviceUrl = mode === 'read_text' ? ocrAiUrl : visualAiUrl;
  const response = await fetchWithTimeout(
    `${serviceUrl}${endpoint}?lang=es`,
    {
      body: body.buffer,
      headers: {
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      method: 'POST',
    },
    35000,
  );

  const rawResponse = await response.text();
  let data: VisualAnalysisResponse = {};
  try {
    data = JSON.parse(rawResponse) as VisualAnalysisResponse;
  } catch {
    // Keep the service status below as the useful error when it returns HTML.
  }

  if (!response.ok) {
    throw new Error(
      data.error || `El servicio de visión no respondió (${response.status}).`,
    );
  }

  const textValue =
    typeof data.text === 'string' ? data.text : data.text?.fullText;
  const result = firstText(
    data.tts,
    data.description,
    data.readingOrder,
    textValue,
    data.denomination,
  );

  if (mode === 'identify_currency') {
    return getArgentineBanknote(result, data);
  }

  if (!result) {
    throw new Error(
      mode === 'read_text'
        ? 'No se encontró texto legible en la imagen.'
        : 'El servicio de visión no devolvió una descripción.',
    );
  }

  return result;
}

function getArgentineBanknote(
  result: string,
  data: VisualAnalysisResponse,
) {
  const source = [result, data.denomination, data.tts, data.description]
    .filter(Boolean)
    .join(' ')
    .replace(/[.$\s]/g, '');
  const denominations = ['20000', '10000', '2000', '1000', '500', '200', '100'];
  const denomination = denominations.find((value) => source.includes(value));

  return denomination
    ? `${Number(denomination).toLocaleString('es-AR')} pesos argentinos`
    : 'No se detectó ningún billete visible.';
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('El análisis tardó demasiado. Intentá nuevamente.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
