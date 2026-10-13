import { NativeModules } from 'react-native';
import { loadLensPairing, saveLensPairing } from '../src/services/LocalWifiLens';

jest.mock('react-native-wifi-reborn', () => ({}));
jest.mock('../src/services/LensAutoProvisioning', () => ({}));

const pairing = {
  ap: 'Lentes-123ABC',
  password: 'test-pairing-password',
  address: 'http://192.168.1.20',
};

afterEach(() => { delete NativeModules.LocalLensCredentials; });

it('reports no paired glasses when the iOS native credential module is absent', async () => {
  await expect(loadLensPairing()).resolves.toBeNull();
});

it('reports an unsupported pairing instead of a native-module crash', async () => {
  await expect(saveLensPairing(pairing)).rejects.toThrow('todavía no está disponible');
});

it('preserves credential storage when the Android module is present', async () => {
  const set = jest.fn().mockResolvedValue(undefined);
  NativeModules.LocalLensCredentials = {
    set,
    get: jest.fn().mockResolvedValue(JSON.stringify(pairing)),
  };
  await saveLensPairing(pairing);
  expect(set).toHaveBeenCalledWith(JSON.stringify(pairing));
  await expect(loadLensPairing()).resolves.toEqual(pairing);
});
