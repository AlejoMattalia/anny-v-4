import {Buffer} from 'buffer';
import type {Device} from 'react-native-ble-plx';
import {discoverAndConfigureLens, validateLensWifi} from '../src/services/LensAutoProvisioning';

let mockRequestId = 0;
let mockStates: object[] = [];
const mockWrite = jest.fn(async (_service, _characteristic, value) => { mockRequestId = Buffer.from(value, 'base64').readUInt32LE(0); });
const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockDevice = {
  id: 'test-device',
  connect: jest.fn(async (): Promise<Device> => mockDevice as unknown as Device),
  discoverAllServicesAndCharacteristics: jest.fn().mockResolvedValue(undefined),
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
  State: {PoweredOn: 'on'},
  BleManager: jest.fn(() => ({state: async () => 'on', startDeviceScan: (_filter: unknown, _options: unknown, callback: Function) => callback(null, mockDevice), stopDeviceScan: jest.fn()})),
}));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

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
