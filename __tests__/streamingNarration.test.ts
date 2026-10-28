import { StreamingNarration, streamingPictureSize } from '../src/services/StreamingNarration';

const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
it('prepares the next scene before speech ends, while reading only one scene at a time', async () => {
  let now = 0; const starts: (() => void)[] = []; const finishes: (() => void)[] = [];
  const read = jest.fn((_text: string, onStart: () => void) => { starts.push(onStart); return new Promise<void>(resolve => finishes.push(resolve)); });
  const queue = new StreamingNarration({ read, current: () => true, speaking: jest.fn(), now: () => now });
  queue.enqueue({ text: 'Uno dos tres cuatro cinco seis siete ocho', generation: 1, capturedAt: 0, analysisMs: 1000 });
  expect(queue.canCapture()).toBe(false); starts[0]();
  now = 500; expect(queue.canCapture()).toBe(false);
  now = 1000; expect(queue.canCapture()).toBe(true);
  queue.enqueue({ text: 'Nueva escena.', generation: 1, capturedAt: 1000, analysisMs: 1000 });
  expect(queue.canCapture()).toBe(false); expect(read).toHaveBeenCalledTimes(1);
  now = 2000; finishes[0](); await tick();
  expect(read).toHaveBeenCalledTimes(2); expect(read.mock.calls[1][0]).toBe('Nueva escena.');
  finishes[1](); await tick(); expect(queue.canCapture()).toBe(true);
});
it('discards a queued scene when the user changes mode or leaves', async () => {
  let finish!: () => void;
  const read = jest.fn((_text: string, onStart: () => void) => { onStart(); return new Promise<void>(resolve => { finish = resolve; }); });
  const queue = new StreamingNarration({ read, current: generation => generation === 1, speaking: jest.fn(), now: () => 0 });
  queue.enqueue({ text: 'Escena actual.', generation: 1, capturedAt: 0, analysisMs: 500 });
  queue.enqueue({ text: 'Escena pendiente.', generation: 1, capturedAt: 0, analysisMs: 500 });
  queue.reset(); finish(); await tick(); expect(read).toHaveBeenCalledTimes(1);
  queue.enqueue({ text: 'Modo anterior.', generation: 0, capturedAt: 0, analysisMs: 500 });
  expect(read).toHaveBeenCalledTimes(1);
});
it('does not read an outdated camera result after a long interruption', () => {
  const read = jest.fn();
  const queue = new StreamingNarration({ read, current: () => true, speaking: jest.fn(), now: () => 10000 });
  queue.enqueue({ text: 'Escena vieja.', generation: 1, capturedAt: 0, analysisMs: 1000 });
  expect(read).not.toHaveBeenCalled(); expect(queue.canCapture()).toBe(true);
});
it('selects a supported small photo size and preserves more detail in text modes', () => {
  const sizes = ['4000x3000', '1280x720', '640x480'];
  expect(streamingPictureSize(sizes, false)).toBe('640x480');
  expect(streamingPictureSize(sizes, true)).toBe('1280x720');
  expect(streamingPictureSize([], false)).toBeUndefined();
});
