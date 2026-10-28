import { startAssistanceFramePump } from '../../src/lib/assistance-frame-pump';

let stop: (() => void) | undefined;
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { stop?.(); stop = undefined; jest.useRealTimers(); });

it('counts upload time toward pacing instead of adding a pause after every response', async () => {
  const capture = jest.fn().mockResolvedValue('current-jpeg');
  const send = jest.fn(() => new Promise<void>(resolve => setTimeout(resolve, 200)));
  stop = startAssistanceFramePump({ capture, send, onFailure: jest.fn() });
  await jest.advanceTimersByTimeAsync(1000);
  // Previously 200 ms HTTP + 150 ms pause delivered only ~3 frames/second.
  expect(send.mock.calls.length).toBeGreaterThanOrEqual(5);
});

it('paces fast networks without overlapping uploads or capturing a backlog on slow ones', async () => {
  const capture = jest.fn().mockResolvedValue('fresh');
  let finish!: () => void;
  const send = jest.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue(undefined);
  stop = startAssistanceFramePump({ capture, send, onFailure: jest.fn() });
  await jest.advanceTimersByTimeAsync(1000);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  finish();
  await jest.advanceTimersByTimeAsync(1000);
  expect(send.mock.calls.length).toBeGreaterThanOrEqual(15);
  expect(send.mock.calls.length).toBeLessThanOrEqual(17);
});

it('aborts the upload and never sends a capture that completes after cleanup', async () => {
  let finish!: (frame: string) => void;
  const capture = jest.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const send = jest.fn();
  stop = startAssistanceFramePump({ capture, send, onFailure: jest.fn() });
  stop();
  finish('late-frame');
  await jest.advanceTimersByTimeAsync(500);
  expect(send).not.toHaveBeenCalled();

  stop = startAssistanceFramePump({ capture: async () => 'fresh', send, onFailure: jest.fn() });
  await jest.advanceTimersByTimeAsync(0);
  const signal = send.mock.calls[0][1] as AbortSignal;
  stop();
  expect(signal.aborted).toBe(true);
  await jest.advanceTimersByTimeAsync(500);
  expect(send).toHaveBeenCalledTimes(1);
});

it('falls back after three consecutive failures and resets the count after success', async () => {
  const onFailure = jest.fn();
  const capture = jest.fn().mockResolvedValue('fresh');
  const send = jest.fn().mockRejectedValue(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);
  stop = startAssistanceFramePump({ capture, send, onFailure });
  await jest.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(6);
  expect(onFailure).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(6);
});
