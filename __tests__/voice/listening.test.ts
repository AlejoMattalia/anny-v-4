import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule as recognition } from 'expo-speech-recognition';
import { listenOnce, speak, speakGuidance, setGuidancePaused, stopListening } from '../../src/lib/voice';
import { setTutorCallActive, setConversationRequested, setConversationNarrator } from '../../src/services/ConversationRuntime';

const mockListeners = new Map<string, Set<(event: unknown) => void>>();
jest.mock('expo-speech', () => ({ stop: jest.fn().mockResolvedValue(undefined), getAvailableVoicesAsync: jest.fn().mockResolvedValue([]), speak: jest.fn((_text, options) => options.onDone()) }));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }), isRecognitionAvailable: () => true,
  start: jest.fn(), abort: jest.fn(), addListener: (name: string, fn: (event: unknown) => void) => {
    if (!mockListeners.has(name)) mockListeners.set(name, new Set()); mockListeners.get(name)!.add(fn);
    return { remove: () => mockListeners.get(name)?.delete(fn) };
  },
} }));
jest.mock('../../src/lib/settings-storage', () => ({ loadSettings: jest.fn().mockResolvedValue({ voiceRate: 1 }) }));
jest.mock('../../src/services/StreamingClock', () => ({ streamingDelay: jest.fn().mockResolvedValue(undefined), streamingTimeout: () => () => {} }));
const emit = (name: string, event: unknown) => mockListeners.get(name)?.forEach(fn => fn(event));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockListeners.clear(); setGuidancePaused(false);
  (recognition.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (recognition.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (recognition.abort as jest.Mock).mockImplementation(() => { emit('error', { error: 'aborted' }); emit('end', null); });
});
afterEach(() => { stopListening(); setConversationNarrator(null); setConversationRequested(false); jest.useRealTimers(); });
it('never falls back to phone TTS while the existing AI conversation reconnects', async () => {
  setConversationRequested(true); setConversationNarrator(null);
  await speak('Primera lectura.', { priority: 'stream' });
  await speak('Segunda lectura.', { priority: 'stream' });
  await speak('Streaming conectado.');
  expect(Speech.speak).not.toHaveBeenCalled();
  const narrator = jest.fn().mockResolvedValue(undefined); setConversationNarrator(narrator);
  expect(narrator).toHaveBeenCalledTimes(1);
  expect(narrator).toHaveBeenCalledWith('Segunda lectura.', { priority: 'stream' });
});
it('uses the final Spanish transcript, removes listeners and suppresses Anny speech during recognition', async () => {
  const result = listenOnce(); await jest.advanceTimersByTimeAsync(0);
  await speak('Un anuncio automático'); expect(Speech.speak).not.toHaveBeenCalled();
  emit('result', { isFinal: true, results: [{ transcript: '  Anny cancelar viaje  ' }] });
  await expect(result).resolves.toBe('Anny cancelar viaje');
  expect([...mockListeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
it('immediately cancels recognition without leaving a promise or listeners waiting', async () => {
  const result = listenOnce(); const rejected = expect(result).rejects.toThrow('cancelada');
  await jest.advanceTimersByTimeAsync(0); stopListening(); await rejected;
  expect([...mockListeners.values()].every(listeners => listeners.size === 0)).toBe(true); expect(jest.getTimerCount()).toBe(0);
});
it('never starts the mic if the user cancels while Android is requesting permission', async () => {
  let finish!: (value: unknown) => void;
  (recognition.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  (recognition.requestPermissionsAsync as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const result = listenOnce(); const rejected = expect(result).rejects.toThrow('cancelada');
  await jest.advanceTimersByTimeAsync(0); stopListening(); finish({ granted: true }); await rejected;
  expect(recognition.start).not.toHaveBeenCalled();
});
it('uses the granted microphone permission without reopening Android permission UI or aborting an idle recognizer', async () => {
  const result = listenOnce({ prompt: 'Te escucho.' }); await jest.advanceTimersByTimeAsync(0);
  expect(recognition.getPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(recognition.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(recognition.abort).not.toHaveBeenCalled();
  expect(recognition.start).toHaveBeenCalledTimes(1);
  emit('start', null);
  emit('result', { isFinal: true, results: [{ transcript: 'contactos' }] });
  await expect(result).resolves.toBe('contactos');
});
it('ignores delayed abort and end events from the previous recognizer while the new session is starting', async () => {
  const result = listenOnce(); await jest.advanceTimersByTimeAsync(0);
  emit('error', { error: 'aborted' }); emit('end', null);
  await jest.advanceTimersByTimeAsync(100);
  expect(jest.getTimerCount()).toBe(1); // Still waiting for the actual user, not silently closed.
  emit('start', null);
  emit('result', { isFinal: true, results: [{ transcript: 'mapa' }] });
  await expect(result).resolves.toBe('mapa');
});
it('reports a recognizer interruption instead of treating it as a user cancellation', async () => {
  const result = listenOnce(); const rejected = expect(result).rejects.toThrow('Se interrumpió el micrófono');
  await jest.advanceTimersByTimeAsync(0); emit('start', null); emit('error', { error: 'aborted' }); await rejected;
});
it('waits for Android to finish the previous abort before starting another microphone session', async () => {
  const first = listenOnce(); const cancelled = expect(first).rejects.toThrow('cancelada');
  await jest.advanceTimersByTimeAsync(0);
  (recognition.abort as jest.Mock).mockImplementationOnce(() => { setTimeout(() => emit('end', null), 500); });
  const second = listenOnce(); await jest.advanceTimersByTimeAsync(0); await cancelled;
  expect(recognition.start).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(499); expect(recognition.start).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); expect(recognition.start).toHaveBeenCalledTimes(2);
  emit('start', null); emit('result', { isFinal: true, results: [{ transcript: 'perfil' }] });
  await expect(second).resolves.toBe('perfil'); expect(jest.getTimerCount()).toBe(0);
});
it('pauses only travel guidance while keeping explicit speech available', async () => {
  setGuidancePaused(true); await speakGuidance('Siguiente esquina'); expect(Speech.speak).not.toHaveBeenCalled();
  await speak('Asistente pausado'); expect(Speech.speak).toHaveBeenCalledWith('Asistente pausado', expect.anything());
  setGuidancePaused(false); await speakGuidance('Siguiente esquina'); expect(Speech.speak).toHaveBeenCalledWith('Siguiente esquina', expect.anything());
});

it('suppresses AI narration and phone TTS throughout a tutor call', async () => {
  const narrator = jest.fn().mockResolvedValue(undefined);
  setConversationRequested(true); setConversationNarrator(narrator);
  setTutorCallActive(true);
  try {
    await speak('Una lectura que llegó tarde.', { priority: 'stream' });
    await speakGuidance('Girá a la derecha.');
    expect(narrator).not.toHaveBeenCalled(); expect(Speech.speak).not.toHaveBeenCalled();
  } finally { setTutorCallActive(false); }
});
