const mockFiles = new Map<string, string>();
const mockFetch = jest.fn();
jest.mock('../../src/lib/auth', () => ({ getAuthSession: jest.fn().mockResolvedValue({ access_token: 'authenticated-token' }) }));
jest.mock('../../src/lib/persistent-storage', () => ({
  readPersistentValue: jest.fn(async (key: string) => mockFiles.get(key) || null),
  writePersistentValue: jest.fn(async (key: string, value: string) => { mockFiles.set(key, value); }),
}));
jest.mock('../../src/lib/voice-conversation', () => ({ voiceApiUrl: 'https://voice.test' }));
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
beforeEach(() => { jest.resetModules(); mockFiles.clear(); mockFetch.mockReset(); global.fetch = mockFetch; jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it('stores voice and vision by mode and only deletes the local outbox after server acknowledgment', async () => {
  const memory = require('../../src/lib/streaming-memory') as typeof import('../../src/lib/streaming-memory');
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  memory.setMemoryOwner('ana');
  memory.rememberStreamingText('supermercado', 'user', 'Busco leche', 'voice');
  memory.rememberStreamingText('supermercado', 'assistant', 'Lácteos a la derecha', 'vision');
  await settle();
  const bodies = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({ ownerId: 'ana', entries: [{ mode: 'supermercado', role: 'user', text: 'Busco leche' }] });
  expect(bodies[1].entries[0].session).toBe(bodies[0].entries[0].session);
  expect(mockFiles.get('anny-memory-ana.json')).toBe('[]');
});
it('retains text offline and retries the same event id', async () => {
  const memory = require('../../src/lib/streaming-memory') as typeof import('../../src/lib/streaming-memory');
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  memory.setMemoryOwner('ana'); memory.rememberStreamingText('viaje', 'assistant', 'Puerta a la izquierda', 'vision');
  await settle();
  const saved = JSON.parse(mockFiles.get('anny-memory-ana.json')!);
  expect(saved).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(15000); await settle();
  expect(JSON.parse(mockFetch.mock.calls[1][1].body).entries[0].id).toBe(saved[0].id);
  expect(mockFiles.get('anny-memory-ana.json')).toBe('[]');
});
it('does not send another accounts pending records after switching user', async () => {
  const memory = require('../../src/lib/streaming-memory') as typeof import('../../src/lib/streaming-memory');
  mockFiles.set('anny-memory-ana.json', JSON.stringify([{ id: 'pending' }]));
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  memory.setMemoryOwner('ana'); memory.setMemoryOwner('juan'); await settle();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(JSON.parse(mockFiles.get('anny-memory-ana.json')!)).toHaveLength(1);
});
it('retrieves only the requested mode and drops an old response after account changes', async () => {
  const memory = require('../../src/lib/streaming-memory') as typeof import('../../src/lib/streaming-memory');
  let respond!: (value: unknown) => void;
  mockFetch.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
  memory.setMemoryOwner('ana');
  const pending = memory.readStreamingMemory('supermercado'); await settle();
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ ownerId: 'ana', mode: 'supermercado' });
  memory.setMemoryOwner('juan');
  respond({ ok: true, json: async () => ({ entries: [{ text: 'Datos de Ana' }] }) });
  expect(await pending).toBe('');
});

it('keeps writing new speech to disk while an earlier upload is stalled', async () => {
  const memory = require('../../src/lib/streaming-memory') as typeof import('../../src/lib/streaming-memory');
  let respond!: (value: unknown) => void;
  mockFetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; })).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  memory.setMemoryOwner('ana'); memory.rememberStreamingText('supermercado', 'user', 'Primera frase', 'voice');
  await settle();
  memory.rememberStreamingText('supermercado', 'user', 'Segunda frase', 'voice'); await settle();
  expect(JSON.parse(mockFiles.get('anny-memory-ana.json')!).map((entry: { text: string }) => entry.text)).toEqual(['Primera frase', 'Segunda frase']);
  respond({ ok: true, json: async () => ({ ok: true }) }); await settle();
  expect(mockFiles.get('anny-memory-ana.json')).toBe('[]');
});
