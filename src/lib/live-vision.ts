import { io, type Socket } from 'socket.io-client';

const liveVisionUrl =
  process.env.EXPO_PUBLIC_LIVE_VISION_URL?.replace(/\/$/, '') ?? 'http://3.15.63.191';

let socket: Socket | null = null;

export async function analyzeLiveFrame(image: string, query?: string) {
  if (!liveVisionUrl) {
    throw new Error('Falta configurar el servidor de visión en tiempo real.');
  }

  const activeSocket = getSocket();
  await waitForConnection(activeSocket);

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Anny tardó demasiado en responder.'));
    }, 35000);

    const onDescription = (payload: { text?: string }) => {
      const text = payload?.text?.trim();
      cleanup();
      if (!text) {
        reject(new Error('Anny no devolvió una descripción.'));
        return;
      }
      resolve(text);
    };
    const onError = (payload: { message?: string }) => {
      cleanup();
      reject(new Error(payload?.message || 'No se pudo analizar la escena.'));
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error('Se perdió la conexión con Anny.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      activeSocket.off('description', onDescription);
      activeSocket.off('error', onError);
      activeSocket.off('disconnect', onDisconnect);
    };

    activeSocket.once('description', onDescription);
    activeSocket.once('error', onError);
    activeSocket.once('disconnect', onDisconnect);
    activeSocket.emit('analyze', { image, query });
  });
}

export function disconnectLiveVision() {
  socket?.disconnect();
  socket = null;
}

function getSocket() {
  if (!socket) {
    socket = io(liveVisionUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      transports: ['websocket'],
    });
  }
  return socket;
}

function waitForConnection(activeSocket: Socket) {
  if (activeSocket.connected) return Promise.resolve();
  activeSocket.connect();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('No se pudo conectar con Anny.'));
    }, 10000);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(error.message || 'No se pudo conectar con Anny.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      activeSocket.off('connect', onConnect);
      activeSocket.off('connect_error', onError);
    };
    activeSocket.once('connect', onConnect);
    activeSocket.once('connect_error', onError);
  });
}
