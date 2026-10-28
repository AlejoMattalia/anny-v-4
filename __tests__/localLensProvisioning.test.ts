import {Buffer} from 'buffer';
import type {Device} from 'react-native-ble-plx';
import {Platform} from 'react-native';
import {discoverAndConfigureLens, validateLensWifi} from '../src/services/LensAutoProvisioning';
import {WifiLensConnectionManager} from '../src/services/WifiLensConnectionManager';

let mockRequestId = 0;
let mockStates: object[] = [];
const mockWrite = jest.fn(async (_service, _characteristic, value) => { mockRequestId = Buffer.from(value, 'base64').readUInt32LE(0); });
const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockStartScan = jest.fn();
const mockStopScan = jest.fn();
const mockCancelDevice = jest.fn().mockResolvedValue(undefined);
const mockDevice = {
  id: 'test-device',
  serviceUUIDs: ['e7a20001-8f21-4c7d-9b32-1c9a52f00100'],
  connect: jest.fn(async (): Promise<Device> => mockDevice as unknown as Device),
  discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue(undefined),
  requestMTU: jest.fn(async (): Promise<Device> => mockDevice as unknown as Device),
  readCharacteristicForService: jest.fn(async (_service, characteristic) => {
    if (characteristic.includes('20004')) { return {value: Buffer.from('internal-device-token').toString('base64')}; }
    if (!mockWrite.mock.calls.length) return {value: Buffer.from(JSON.stringify({multi: false})).toString('base64')};
    const next = mockStates.shift() || {};
    return {value: Buffer.from(JSON.stringify({request_id: mockRequestId, ...next})).toString('base64')};
  }),
  writeCharacteristicWithResponseForService: mockWrite,
  cancelConnection: mockCancel,
};
jest.mock('react-native-ble-plx', () => ({
  State: {PoweredOn: 'on'}, ScanMode: {LowLatency: 2},
  BleManager: jest.fn(() => ({state: async () => 'on', startDeviceScan: mockStartScan, stopDeviceScan: mockStopScan, cancelDeviceConnection: mockCancelDevice})),
}));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockStartScan.mockReset().mockImplementation((_filter: unknown, _options: unknown, callback: Function) => callback(null, mockDevice));
});
afterEach(() => {Platform.OS = 'ios'; jest.useRealTimers();});

it('ignores a previous successful request and starts only after this network is saved', async () => {
  mockStates = [
    {request_id: 0, result: 'saved', connected: true, ssid: 'My WiFi'},
    {result: 'connecting'},
    {result: 'saved', connected: true, ssid: 'My WiFi', ip: '192.168.1.20', ap: 'Lentes-123ABC'},
  ];
  let finished = false;
  const pending = discoverAndConfigureLens('My WiFi', 'test-password', () => {}, new AbortController().signal).then(value => {finished = true; return value;});
  await jest.advanceTimersByTimeAsync(2500);
  expect(finished).toBe(false);
  await jest.advanceTimersByTimeAsync(1500);
  await expect(pending).resolves.toMatchObject({address: '192.168.1.20', id: 'test-device'});
  expect(mockCancel).toHaveBeenCalledTimes(1);
});
it('reports rejected Wi-Fi and releases the proximity connection', async () => {
  mockStates = [{result: 'failed'}];
  const assertion = expect(discoverAndConfigureLens('My WiFi', 'wrong-password', () => {}, new AbortController().signal)).rejects.toThrow('La red anterior se conserva');
  await jest.advanceTimersByTimeAsync(2000);
  await assertion;
  expect(mockCancel).toHaveBeenCalledTimes(1);
});

it('validates Wi-Fi names by UTF-8 bytes and rejects embedded nulls', () => {
  expect(() => validateLensWifi('á'.repeat(17), 'valid-password')).toThrow();
  expect(() => validateLensWifi('Home\0Other', 'valid-password')).toThrow();
  expect(() => validateLensWifi('Home', 'short')).toThrow();
  expect(() => validateLensWifi('á'.repeat(16), 'valid-password')).not.toThrow();
});

it('keeps the same connection modal open through two missed scans and connects on the third', async () => {
  mockStartScan.mockImplementationOnce(() => {}).mockImplementationOnce(() => {});
  mockStates = [{result: 'saved', connected: true, ssid: 'My WiFi', ip: '192.168.1.20', ap: 'Lentes-123ABC'}];
  const changed = jest.fn();
  const save = jest.fn().mockResolvedValue(undefined);
  const network = {id: 'home', ssid: 'My WiFi', password: 'test-password', type: 'wifi' as const, createdAt: 1};
  const owner = new WifiLensConnectionManager({
    networks: async () => [network], pairing: async () => null, scan: async () => [],
    configure: (_pair, selected, progress, signal) => discoverAndConfigureLens(selected.ssid, selected.password, progress, signal),
    probe: async pair => ({address: pair.address, state: {camera: true, connected: true, ap_active: false, ssid: 'My WiFi', ip: '192.168.1.20', hostname: pair.ap, saved: true, result: 'saved'}}),
    save,
  }, changed);
  owner.setMode(true, 'wifi');
  const pending = owner.connect(network);
  await jest.advanceTimersByTimeAsync(21000);
  expect(mockStartScan).toHaveBeenCalledTimes(2);
  expect(owner.state).toMatchObject({phase: 'connecting', showDialog: true, message: 'Buscando tus lentes…'});
  await jest.advanceTimersByTimeAsync(18000);
  expect(owner.state).toMatchObject({phase: 'connecting', showDialog: true, message: 'Buscando tus lentes…'});
  expect(mockWrite).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2500);
  await expect(pending).resolves.toBe(true);
  expect(mockStartScan).toHaveBeenCalledTimes(3);
  expect(mockStopScan).toHaveBeenCalledTimes(3);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(owner.state).toMatchObject({phase: 'connected', showDialog: false});
  expect(changed.mock.calls.some(([state]) => /intento/i.test(state.message))).toBe(false);
});

it('reports not found only after all three 20-second searches finish', async () => {
  mockStartScan.mockImplementation(() => {});
  let completed = false;
  const pending = discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal);
  const result = expect(pending).rejects.toThrow('No se encontraron los lentes');
  void pending.catch(() => {completed = true;});
  await jest.advanceTimersByTimeAsync(59999);
  expect(completed).toBe(false);
  expect(mockStartScan).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(1);
  await result;
  expect(mockStopScan).toHaveBeenCalledTimes(3);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('cancels during the second search without starting a third', async () => {
  mockStartScan.mockImplementation(() => {});
  const controller = new AbortController();
  const pending = discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), controller.signal);
  const result = expect(pending).rejects.toThrow('Conexión cancelada');
  await jest.advanceTimersByTimeAsync(21000);
  controller.abort();
  await result;
  await jest.advanceTimersByTimeAsync(60000);
  expect(mockStartScan).toHaveBeenCalledTimes(2);
  expect(mockStopScan).toHaveBeenCalledTimes(2);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('reports a Bluetooth scanner error immediately instead of silently retrying it', async () => {
  mockStartScan.mockImplementation((_filter, _options, callback) => callback(new Error('Bluetooth disabled')));
  await expect(discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal))
    .rejects.toThrow('Revisá Bluetooth y los permisos');
  await jest.advanceTimersByTimeAsync(60000);
  expect(mockStartScan).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('handles a rejected native scan promise and uses foreground scan mode', async () => {
  mockStartScan.mockImplementationOnce(() => Promise.reject(new Error('Native scanner rejected')));
  await expect(discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal))
    .rejects.toThrow('Revisá Bluetooth y los permisos');
  expect(mockStartScan).toHaveBeenCalledWith(expect.any(Array), {scanMode: 2}, expect.any(Function));
  expect(mockStopScan).toHaveBeenCalledTimes(1);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it.each([undefined, 'test-device'])('finds only the intended lens without Android hardware scan filters (saved=%s)', async knownId => {
  Platform.OS = 'android';
  mockStates = [{result: 'saved', connected: true, ssid: 'My WiFi', ip: '192.168.1.20', ap: 'Lentes-123ABC'}];
  mockStartScan.mockImplementationOnce((filter, _options, callback) => {
    expect(filter).toBeNull();
    callback(null, {id: 'unrelated', serviceUUIDs: []});
    if (knownId) callback(null, {...mockDevice, id: 'another-lens'});
    callback(null, knownId ? {...mockDevice, serviceUUIDs: []} : mockDevice);
  });
  const pending = discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal, knownId);
  await jest.advanceTimersByTimeAsync(1500);
  await expect(pending).resolves.toMatchObject({id: 'test-device'});
  expect(mockDevice.connect).toHaveBeenCalledTimes(1);
});

it('reports a native stop failure instead of hanging or starting a concurrent scan', async () => {
  mockStopScan.mockImplementationOnce(() => Promise.reject(new Error('Scan could not stop')));
  await expect(discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal))
    .rejects.toThrow('Scan could not stop');
  expect(mockStartScan).toHaveBeenCalledTimes(1);
  expect(mockDevice.connect).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('times out a native service discovery that never returns and releases Bluetooth', async () => {
  mockDevice.discoverAllServicesAndCharacteristics.mockImplementationOnce(() => new Promise(() => {}));
  const result = expect(discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), new AbortController().signal))
    .rejects.toThrow('servicios Bluetooth');
  await jest.advanceTimersByTimeAsync(15000);
  await result;
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

it('cancels an unresponsive Bluetooth operation without waiting for its result', async () => {
  mockDevice.discoverAllServicesAndCharacteristics.mockImplementationOnce(() => new Promise(() => {}));
  const controller = new AbortController();
  const result = expect(discoverAndConfigureLens('My WiFi', 'test-password', jest.fn(), controller.signal))
    .rejects.toThrow('Conexión cancelada');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  expect(mockCancelDevice).toHaveBeenCalledWith('test-device');
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
