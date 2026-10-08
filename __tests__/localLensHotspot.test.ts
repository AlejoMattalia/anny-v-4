import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import {configureLocalLens} from '../src/services/LocalWifiLens';

jest.mock('react-native-wifi-reborn', () => ({
  getCurrentWifiSSID: jest.fn().mockResolvedValue('another-network'),
  connectToProtectedWifiSSID: jest.fn().mockResolvedValue(undefined),
  forceWifiUsageWithOptions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/LensAutoProvisioning', () => ({
  discoverAndConfigureLens: jest.fn().mockResolvedValue({
    id: 'lens',
    ap: 'Lentes-123ABC',
    password: 'device-key',
    address: '192.168.43.25',
  }),
}));
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  NativeModules.LocalLensCredentials = {
    set: jest.fn().mockResolvedValue(undefined),
  };
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        camera: true,
        connected: true,
        ap_active: false,
        ssid: 'My phone',
      }),
    });
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

it('configures the glasses on the phone hotspot without joining its own SSID', async () => {
  const pair = await configureLocalLens(
    null,
    'My phone',
    'test-password',
    jest.fn(),
    new AbortController().signal,
    'hotspot',
  );
  expect(pair.networkType).toBe('hotspot');
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  expect(WifiManager.forceWifiUsageWithOptions).toHaveBeenCalledWith(false, {
    noInternet: false,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    'http://192.168.43.25/api/status',
    expect.anything(),
  );
});

it('still joins a router when Wi-Fi is selected', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        camera: true,
        connected: true,
        ap_active: false,
        ssid: 'My router',
      }),
    });
  await configureLocalLens(
    null,
    'My router',
    'test-password',
    jest.fn(),
    new AbortController().signal,
    'wifi',
  );
  expect(WifiManager.connectToProtectedWifiSSID).toHaveBeenCalledWith(
    expect.objectContaining({ssid: 'My router', password: 'test-password'}),
  );
  expect(WifiManager.forceWifiUsageWithOptions).toHaveBeenCalledWith(true, {
    noInternet: false,
  });
});
