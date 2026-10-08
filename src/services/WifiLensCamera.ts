import {hasLocalLensTransport, requestLocalLens} from './LocalLensTransport';
import {Buffer} from 'buffer';
import {NativeModules} from 'react-native';
import {LensPairing} from './LocalWifiLens';
import {normalizeLocalLensAddress} from './localLensAddress';

/** A fresh frame from the physical Wi-Fi lens, for the existing AI flows. */
export async function captureWifiLens(
  session: LensPairing,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) {
    controller.abort();
  }
  const timeout = setTimeout(cancel, 15000);
  try {
    const frames = NativeModules.LocalLensFrames;
    const endpoint = `${normalizeLocalLensAddress(session.address)}/stream`;
    if (frames?.captureStreamFrame && !controller.signal.aborted) {
      // Wait up to 2 s for a fresh frame if the preview is active. A timeout
      // must not open /capture and compete with that same slow stream.
      const live = await frames.captureStreamFrame(endpoint, session.password);
      if (controller.signal.aborted) {throw new Error('Captura cancelada.');}
      if (live !== null) {
        // JPEG markers/size are validated by the native stream reader. Avoid
        // decoding base64 back into a second JS buffer solely to check them.
        if (typeof live !== 'string' || live.length < 8 || live.length > 1398104) {
          throw new Error('La imagen de los lentes está incompleta.');
        }
        return live;
      }
    } else if (frames?.getLatestFrame && !controller.signal.aborted) {
      // Compatibility with an older APK while its native module is upgraded.
      const live = await frames.getLatestFrame(endpoint, session.password).catch(() => null);
      if (controller.signal.aborted) {throw new Error('Captura cancelada.');}
      if (typeof live === 'string' && live.length <= 1398104) {
        const jpeg = Buffer.from(live, 'base64');
        if (jpeg.length >= 4 && jpeg.length <= 1024 * 1024 &&
          jpeg[0] === 0xff && jpeg[1] === 0xd8 &&
          jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9) {
          return live;
        }
      }
    }
    if (hasLocalLensTransport()) {
      const response = await requestLocalLens(`${normalizeLocalLensAddress(session.address)}/capture`,
        session.password, undefined, 15000, controller.signal);
      if (response.status !== 200 || !response.contentType.toLowerCase().startsWith('image/jpeg')) {
        throw new Error('No se pudo capturar una imagen de los lentes.');
      }
      const jpeg = Buffer.from(response.body, 'base64');
      if (jpeg.length < 4 || jpeg.length > 1048576 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 ||
          jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
        throw new Error('La imagen de los lentes está incompleta.');
      }
      if (controller.signal.aborted) {throw new Error('Captura cancelada.');}
      return response.body;
    }
    const response = await fetch(
      `${normalizeLocalLensAddress(session.address)}/capture`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `admin:${session.password}`,
          ).toString('base64')}`,
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error('No se pudo capturar una imagen de los lentes.');
    }
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('image/jpeg')
    ) {
      throw new Error('Los lentes no devolvieron una imagen JPEG.');
    }
    const blob = await response.blob();
    if (blob.size < 4 || blob.size > 1024 * 1024) {
      throw new Error('La imagen de los lentes está incompleta.');
    }
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      const abortRead = () => {
        reader.abort();
        reject(new Error('Captura cancelada.'));
      };
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () =>
        reject(new Error('No se pudo leer la imagen de los lentes.'));
      reader.onabort = () => reject(new Error('Captura cancelada.'));
      reader.onloadend = () =>
        controller.signal.removeEventListener('abort', abortRead);
      if (controller.signal.aborted) {
        reject(new Error('Captura cancelada.'));
        return;
      }
      controller.signal.addEventListener('abort', abortRead);
      reader.readAsDataURL(blob);
    });
    if (controller.signal.aborted) {
      throw new Error('Captura cancelada.');
    }
    const jpeg = Buffer.from(encoded, 'base64');
    if (
      jpeg[0] !== 0xff ||
      jpeg[1] !== 0xd8 ||
      jpeg[jpeg.length - 2] !== 0xff ||
      jpeg[jpeg.length - 1] !== 0xd9
    ) {
      throw new Error('La imagen de los lentes está incompleta.');
    }
    return encoded;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
