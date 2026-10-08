import {Buffer} from 'buffer';
import {captureWifiLens} from '../src/services/WifiLensCamera';

const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const pair = {address: '192.168.1.25', password: 'device-secret', ap: 'Lentes-123ABC'};
const originalReader = global.FileReader;
const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: {get: () => 'image/jpeg'},
    blob: async () => ({size: jpeg.length, encoded: jpeg.toString('base64')}),
  });
  global.fetch = mockFetch;
  global.FileReader = class {
    result = '';
    onload?: () => void;
    onloadend?: () => void;
    onabort?: () => void;
    readAsDataURL(blob: {encoded: string}) {
      this.result = `data:image/jpeg;base64,${blob.encoded}`;
      this.onload?.();
      this.onloadend?.();
    }
    abort() { this.onabort?.(); this.onloadend?.(); }
  } as unknown as typeof FileReader;
});
afterEach(() => { global.FileReader = originalReader; global.fetch = originalFetch; jest.useRealTimers(); });

it('captures an authenticated fresh JPEG directly from the selected lens', async () => {
  await expect(captureWifiLens(pair)).resolves.toBe(jpeg.toString('base64'));
  expect(mockFetch).toHaveBeenCalledWith('http://192.168.1.25/capture', expect.objectContaining({
    headers: expect.objectContaining({Authorization: `Basic ${Buffer.from('admin:device-secret').toString('base64')}`}),
  }));
});

it('does not send lens credentials to a public host', async () => {
  await expect(captureWifiLens({...pair, address: 'https://example.com'})).rejects.toThrow();
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  {ok: false},
  {headers: {get: () => 'text/html'}},
  {blob: async () => ({size: 2})},
  {blob: async () => ({size: 2000000})},
  {blob: async () => ({size: 6, encoded: Buffer.from('broken').toString('base64')})},
])('rejects failed or incomplete captures instead of passing them to AI', async overrides => {
  const response = await mockFetch();
  mockFetch.mockResolvedValue({...response, ...overrides});
  await expect(captureWifiLens(pair)).rejects.toThrow();
});

it('cancels an in-flight capture when the camera screen closes', async () => {
  mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const controller = new AbortController();
  const result = captureWifiLens(pair, controller.signal);
  const assertion = expect(result).rejects.toThrow('aborted');
  controller.abort();
  await assertion;
});

it('limits a stalled camera request to 15 seconds', async () => {
  jest.useFakeTimers();
  mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('timeout')));
  }));
  const assertion = expect(captureWifiLens(pair)).rejects.toThrow('timeout');
  await jest.advanceTimersByTimeAsync(15000);
  await assertion;
});
