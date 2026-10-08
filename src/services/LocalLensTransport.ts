import {NativeModules} from 'react-native';

type LensResponse = {status: number; contentType: string; body: string};
let sequence = 0;
export const hasLocalLensTransport = () => Boolean(NativeModules.LocalLensNetwork?.request);

/** One cancellable request over the network that actually reaches the lens. */
export async function requestLocalLens(
  target: string, secret: string, data: string | undefined, timeout: number, signal?: AbortSignal,
): Promise<LensResponse> {
  if (signal?.aborted) {throw new Error('Conexión cancelada.');}
  const id = `lens-${Date.now()}-${++sequence}`;
  const transport = NativeModules.LocalLensNetwork;
  return new Promise((resolve, reject) => {
    const abort = () => {transport.cancel(id); reject(new Error('Conexión cancelada.'));};
    signal?.addEventListener('abort', abort, {once: true});
    transport.request(id, target, secret, data ?? null, timeout).then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', abort));
  });
}
