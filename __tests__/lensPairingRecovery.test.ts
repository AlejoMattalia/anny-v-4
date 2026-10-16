import {NativeModules} from 'react-native';
import {loadLensPairing, saveLensPairing} from '../src/services/LocalWifiLens';
import {WifiLensConnectionManager} from '../src/services/WifiLensConnectionManager';

jest.mock('react-native-wifi-reborn', () => ({}));
jest.mock('../src/services/LensAutoProvisioning', () => ({}));

const pair = {ap: 'Lentes-123abc', password: 'device-secret', address: '192.168.1.20'};
const network = {id: 'home', ssid: 'Home', password: 'wifi-secret', type: 'wifi' as const, createdAt: 1};

beforeEach(() => {
  NativeModules.LocalLensCredentials = {
    get: jest.fn().mockResolvedValue(JSON.stringify(pair)),
    set: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('loads and normalizes a working pairing', async () => {
  await expect(loadLensPairing()).resolves.toEqual({...pair, address: 'http://192.168.1.20'});
});

it.each([null, '{invalid', 'null', '{}', JSON.stringify({...pair, address: 'https://example.com'}), JSON.stringify({...pair, password: ''})])(
  'allows pairing again when stored data is missing or invalid (%s)', async value => {
    NativeModules.LocalLensCredentials.get.mockResolvedValue(value);
    await expect(loadLensPairing()).resolves.toBeNull();
    expect(NativeModules.LocalLensCredentials.clear).not.toHaveBeenCalled();
  },
);

it('does not hide unrelated native failures', async () => {
  const error = Object.assign(new Error('Native module unavailable'), {code: 'UNAVAILABLE'});
  NativeModules.LocalLensCredentials.get.mockRejectedValue(error);
  await expect(loadLensPairing()).rejects.toBe(error);
});

it.each([true, false])('retries BLE after a lost encryption key, persisting only a confirmed connection (reachable=%s)', async reachable => {
  NativeModules.LocalLensCredentials.get.mockRejectedValue(
    Object.assign(new Error('Volvé a vincular los lentes'), {code: 'PAIRING_STORAGE'}),
  );
  const configure = jest.fn().mockResolvedValue(pair);
  const probe = reachable
    ? jest.fn().mockResolvedValue({address: 'http://192.168.1.20', state: {connected: true, ssid: 'Home'}})
    : jest.fn().mockRejectedValue(new Error('Lens offline'));
  const manager = new WifiLensConnectionManager({
    networks: async () => [network], pairing: loadLensPairing,
    scan: async () => [], configure, probe, save: saveLensPairing,
  }, jest.fn());
  manager.setMode(true, 'wifi');
  await expect(manager.connect(network)).resolves.toBe(reachable);
  expect(configure).toHaveBeenCalledWith(null, network, expect.any(Function), expect.any(AbortSignal));
  expect(NativeModules.LocalLensCredentials.set).toHaveBeenCalledTimes(reachable ? 1 : 0);
  expect(NativeModules.LocalLensCredentials.clear).not.toHaveBeenCalled();
  expect(manager.state.phase).toBe(reachable ? 'connected' : 'disconnected');
});
