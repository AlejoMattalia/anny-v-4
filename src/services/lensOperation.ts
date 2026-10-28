/** A discovery failure cannot be fixed by submitting another saved Wi-Fi password. */
export class LensDiscoveryError extends Error {}

/** Bound native promises even when the bridge never resolves or ignores cancellation. */
export function waitForLensOperation<T>(
  work: () => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const cancel = () => finish(new Error('Conexión cancelada.'));
    if (signal?.aborted) {cancel(); return;}
    signal?.addEventListener('abort', cancel, {once: true});
    timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    try {work().then(value => finish(undefined, value), error => finish(error));}
    catch (error) {finish(error);}
  });
}
