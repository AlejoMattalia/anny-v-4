type FramePumpOptions = {
  capture: () => Promise<string | undefined>;
  send: (frame: string, signal: AbortSignal) => Promise<unknown>;
  onFailure: () => void;
};

/** Forward current frames in order, without building a queue on slow networks. */
export function startAssistanceFramePump({ capture, send, onFailure }: FramePumpOptions) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  async function next() {
    const started = performance.now();
    let succeeded = false;
    try {
      const frame = await capture();
      if (controller.signal.aborted) return;
      if (!frame) throw new Error('No hay imagen de los lentes.');
      await send(frame, controller.signal);
      failures = 0;
      succeeded = true;
    } catch {
      if (!controller.signal.aborted && ++failures >= 3) {
        controller.abort();
        onFailure();
        return;
      }
    }
    if (!controller.signal.aborted) {
      // At most 15 FPS. Capture and HTTP time count toward the interval;
      // waiting another 150 ms after each response used to cap even LAN at 6 FPS.
      const delay = succeeded ? Math.max(0, Math.ceil(1000 / 15 - (performance.now() - started))) : 150;
      timer = setTimeout(() => void next(), delay);
    }
  }
  void next();
  return () => { controller.abort(); clearTimeout(timer); };
}
