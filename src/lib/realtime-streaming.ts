import { io, type Socket } from 'socket.io-client';
import { normalizeStreamingCurrency } from '../services/StreamingResponse';
import { STREAMING_MODES, type StreamingMode } from '../services/StreamingModes';

// Same Socket.IO service and default mode as anny-app-v3/RealtimeStreaming.
// Image scanning keeps its separate Elastic Beanstalk REST service.
export const realtimeAiUrl =
  process.env.EXPO_PUBLIC_REALTIME_AI_URL?.replace(/\/$/, '') ||
  'http://ec2-3-15-63-191.us-east-2.compute.amazonaws.com';
let mode: StreamingMode = 'viaje';
let modeVersion = 0;
const pending = new Set<() => void>();
let socket: Socket | null = null;
let nextRequestId = Date.now();

type Description = { text?: string; mode?: string; requestId?: number };
type VisionError = { message?: string; requestId?: number };

function getSocket() {
  if (!socket) {
    socket = io(realtimeAiUrl, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
    const activeSocket = socket;
    activeSocket.on('connect', () => activeSocket.emit('set_mode', { mode }));
  }
  return socket;
}

async function connect(activeSocket: Socket) {
  if (activeSocket.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('No se pudo conectar con Anny.')), 10000);
    const onConnect = () => finish();
    const onError = () => finish(new Error('No se pudo conectar con Anny.'));
    function finish(error?: Error) {
      clearTimeout(timer);
      activeSocket.off('connect', onConnect);
      activeSocket.off('connect_error', onError);
      activeSocket.off('disconnect', onError);
      if (error) reject(error);
      else resolve();
    }
    activeSocket.once('connect', onConnect);
    activeSocket.once('connect_error', onError);
    activeSocket.once('disconnect', onError);
    activeSocket.connect();
  });
}

export async function checkRealtimeAiHealth() {
  try {
    await connect(getSocket());
    return true;
  } catch {
    return false;
  }
}

export async function analyzeRealtimeImage(image: string, query?: string) {
  const requestMode = mode;
  const version = modeVersion;
  const activeSocket = getSocket();
  await connect(activeSocket);
  if (version !== modeVersion) throw new Error('Análisis cancelado por cambio de modo.');
  const requestId = ++nextRequestId;
  const requestedQuery = query?.trim();
  const queryToSend = requestedQuery
    ? `${requestedQuery} Respondé en una frase breve y completa, de hasta 20 palabras.`
    : STREAMING_MODES[requestMode].query;
  const groundedQuery = `${queryToSend} Basate solo en lo visible: identificá objetos concretos y su posición relativa. No inventes textos, precios ni distancias; si un detalle no se distingue, indicá que no es legible.`;

  return new Promise<string>((resolve, reject) => {
    const cancel = () => finish(new Error('Análisis cancelado por cambio de modo.'));
    const timer = setTimeout(() => finish(new Error('Anny tardó demasiado en responder.')), 30000);
    const onDescription = (payload: Description) => {
      if ((payload.requestId !== undefined && payload.requestId !== requestId) ||
          (payload.mode !== undefined && payload.mode !== requestMode)) return;
      const text = payload.text?.trim();
      if (!text) finish(new Error('Anny no devolvió una descripción.'));
      else finish(undefined, normalizeStreamingCurrency(text));
    };
    const onError = (payload: VisionError) => {
      if (payload.requestId !== undefined && payload.requestId !== requestId) return;
      finish(new Error(payload.message || 'No se pudo analizar la escena.'));
    };
    const onDisconnect = () => finish(new Error('Se perdió la conexión con Anny.'));
    function finish(error?: Error, text?: string) {
      pending.delete(cancel);
      clearTimeout(timer);
      activeSocket.off('description', onDescription);
      activeSocket.off('error', onError);
      activeSocket.off('disconnect', onDisconnect);
      if (error) reject(error);
      else resolve(text!);
    }
    activeSocket.on('description', onDescription);
    activeSocket.on('error', onError);
    activeSocket.on('disconnect', onDisconnect);
    pending.add(cancel);
    activeSocket.emit('analyze', { image, query: groundedQuery, mode: requestMode, requestId });
  });
}

export function setRealtimeMode(nextMode: StreamingMode) {
  modeVersion += 1;
  mode = nextMode;
  pending.forEach(cancel => cancel());
  if (socket?.connected) socket.emit('set_mode', { mode });
}

export function disconnectRealtimeAi() {
  modeVersion += 1;
  socket?.disconnect();
  socket = null;
  mode = 'viaje';
}
