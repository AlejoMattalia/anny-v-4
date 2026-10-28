import { conversationDeadline, ConversationStartupTimeout, releasePreviousVoice } from '../../src/services/ConversationStartup';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('allows startup to continue when the native TTS stop never resolves', async () => {
  const signal = new AbortController().signal;
  let continued = false;
  const startup = releasePreviousVoice(() => new Promise(() => {}), signal).then(() => { continued = true; });
  await jest.advanceTimersByTimeAsync(1999); expect(continued).toBe(false);
  await jest.advanceTimersByTimeAsync(1); await startup;
  expect(continued).toBe(true); expect(jest.getTimerCount()).toBe(0);
});
it('rejects a native operation that never settles with an actionable timeout', async () => {
  const pending = conversationDeadline(new Promise(() => {}), 1000, 'Revisá el micrófono.');
  const rejected = expect(pending).rejects.toBeInstanceOf(ConversationStartupTimeout);
  await jest.advanceTimersByTimeAsync(1000); await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
it('cancels immediately when leaving the screen, even if native cancellation does not work', async () => {
  const controller = new AbortController();
  const pending = conversationDeadline(new Promise(() => {}), 60000, 'Timeout', controller.signal);
  const rejected = expect(pending).rejects.toThrow('cancelada');
  controller.abort(); await rejected;
  expect(jest.getTimerCount()).toBe(0);
});
it('never resumes a cancelled startup after the old speech promise eventually resolves', async () => {
  const controller = new AbortController(); let finish!: () => void;
  const pending = releasePreviousVoice(() => new Promise<void>(resolve => { finish = resolve; }), controller.signal);
  const rejected = expect(pending).rejects.toThrow('cancelada');
  controller.abort(); await rejected; finish(); await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
});
