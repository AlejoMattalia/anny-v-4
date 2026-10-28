import { EventEmitter } from 'events';
import { STREAMING_MODES, type StreamingMode } from '../src/services/StreamingModes';

import { io } from 'socket.io-client';
import { prepareVisionUpload } from '../src/lib/vision-upload';
import { analyzeRealtimeImage, checkRealtimeAiHealth, disconnectRealtimeAi, setRealtimeMode } from '../src/lib/realtime-streaming';

const mockSocket = Object.assign(new EventEmitter(), {
  connected: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
});
const mockEmit = jest.spyOn(mockSocket, 'emit');
jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }));
jest.mock('../src/lib/vision-upload', () => ({ prepareVisionUpload: jest.fn(async (image: string) => image) }));
async function settle() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

beforeEach(() => {
  jest.useFakeTimers();
  mockSocket.removeAllListeners();
  mockSocket.connected = false;
  jest.clearAllMocks();
  mockSocket.connect.mockImplementation(() => {
    mockSocket.connected = true;
    mockSocket.emit('connect');
  });
  mockSocket.disconnect.mockImplementation(() => {
    mockSocket.connected = false;
    mockSocket.emit('disconnect');
  });
});
afterEach(() => { disconnectRealtimeAi(); jest.useRealTimers(); });

it('connects to the v3 streaming server and selects viaje over Socket.IO', async () => {
  expect(await checkRealtimeAiHealth()).toBe(true);
  expect(io).toHaveBeenCalledWith('http://ec2-3-15-63-191.us-east-2.compute.amazonaws.com', expect.objectContaining({ transports: ['websocket'] }));
  expect(mockEmit).toHaveBeenCalledWith('set_mode', { mode: 'viaje' });
});

it('sends the v3 brief query, ignores stale replies and speaks currency as pesos', async () => {
  const pending = analyzeRealtimeImage('data:image/jpeg;base64,frame');
  await settle();
  const payload = mockEmit.mock.calls.find(([event]) => event === 'analyze')![1];
  expect(payload).toEqual(expect.objectContaining({ image: 'data:image/jpeg;base64,frame', mode: 'viaje', query: expect.stringContaining(STREAMING_MODES.viaje.query) }));
  mockSocket.emit('description', { text: 'Vieja', requestId: payload.requestId - 1 });
  mockSocket.emit('description', { text: 'Otro modo', requestId: payload.requestId, mode: 'seguro' });
  expect(mockSocket.listenerCount('description')).toBe(1);
  mockSocket.emit('description', { text: 'Cuesta $500.', requestId: payload.requestId, mode: 'viaje' });
  await expect(pending).resolves.toBe('Cuesta 500 pesos.');
  expect(mockSocket.listenerCount('description')).toBe(0);
});

it('preserves the spoken question and adds the v3 brevity instruction', async () => {
  const pending = analyzeRealtimeImage('image', '¿Dónde está la puerta?');
  await settle();
  const payload = mockEmit.mock.calls.find(([event]) => event === 'analyze')![1];
  expect(payload.query).toContain('¿Dónde está la puerta? Respondé en una frase breve y completa, de hasta 20 palabras.');
  expect(payload.query).toContain('No inventes textos, precios ni distancias');
  mockSocket.emit('description', { text: 'A tu derecha.', requestId: payload.requestId });
  await expect(pending).resolves.toBe('A tu derecha.');
});

it('rejects and clears pending listeners on disconnect', async () => {
  const pending = analyzeRealtimeImage('image');
  const rejected = expect(pending).rejects.toThrow('Se perdió la conexión');
  await settle();
  disconnectRealtimeAi();
  await rejected;
  expect(mockSocket.listenerCount('description')).toBe(0);
});

it.each(Object.keys(STREAMING_MODES) as StreamingMode[])('sends the v3 prompt and selected mode: %s', async mode => {
  setRealtimeMode(mode);
  const pending = analyzeRealtimeImage('image');
  await settle();
  const payload = mockEmit.mock.calls.find(([event]) => event === 'analyze')![1];
  expect(mockEmit).toHaveBeenCalledWith('set_mode', { mode });
  expect(payload).toEqual(expect.objectContaining({ mode, query: expect.stringContaining(STREAMING_MODES[mode].query) }));
  mockSocket.emit('description', { text: 'Respuesta.', requestId: payload.requestId, mode });
  await expect(pending).resolves.toBe('Respuesta.');
});

it('cancels the previous mode and ignores its late response after switching back', async () => {
  const first = analyzeRealtimeImage('old image');
  const cancelled = expect(first).rejects.toThrow('cambio de modo');
  await settle();
  const old = mockEmit.mock.calls.find(([event]) => event === 'analyze')![1];
  setRealtimeMode('seguro');
  await cancelled;
  setRealtimeMode('viaje');
  const current = analyzeRealtimeImage('new image');
  await settle();
  const requests = mockEmit.mock.calls.filter(([event]) => event === 'analyze');
  const latest = requests[requests.length - 1][1];
  mockSocket.emit('description', { text: 'Respuesta vieja', mode: 'viaje', requestId: old.requestId });
  expect(mockSocket.listenerCount('description')).toBe(1);
  mockSocket.emit('description', { text: 'Respuesta actual', mode: 'viaje', requestId: latest.requestId });
  await expect(current).resolves.toBe('Respuesta actual');
});

it('restores the selected mode after a socket reconnect', async () => {
  await checkRealtimeAiHealth();
  setRealtimeMode('facultad');
  mockEmit.mockClear();
  mockSocket.emit('connect');
  expect(mockEmit).toHaveBeenCalledWith('set_mode', { mode: 'facultad' });
});

it('does not send an old frame when mode changes while connecting', async () => {
  mockSocket.connect.mockImplementation(() => {});
  const result = analyzeRealtimeImage('old frame');
  const cancelled = expect(result).rejects.toThrow('cambio de modo');
  setRealtimeMode('deporte');
  mockSocket.connected = true;
  mockSocket.emit('connect');
  await cancelled;
  expect(mockEmit.mock.calls.some(([event]) => event === 'analyze')).toBe(false);
});


it('sends the prepared image instead of the original full-resolution frame', async () => {
  (prepareVisionUpload as jest.Mock).mockResolvedValueOnce('compressed frame');
  const result = analyzeRealtimeImage('large frame');
  await settle();
  expect(prepareVisionUpload).toHaveBeenCalledWith('large frame', 'stream');
  const payload = mockEmit.mock.calls.find(([event]) => event === 'analyze')![1];
  expect(payload.image).toBe('compressed frame');
  mockSocket.emit('description', { text: 'Un objeto.', requestId: payload.requestId });
  await expect(result).resolves.toBe('Un objeto.');
});

it('discards a frame if the mode changes while image preparation is pending', async () => {
  let finish!: (image: string) => void;
  (prepareVisionUpload as jest.Mock).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const result = analyzeRealtimeImage('large old frame');
  const cancelled = expect(result).rejects.toThrow('cambio de modo');
  setRealtimeMode('deporte');
  finish('compressed old frame');
  await cancelled;
  expect(mockEmit.mock.calls.some(([event]) => event === 'analyze')).toBe(false);
});
