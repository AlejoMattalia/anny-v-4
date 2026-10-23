import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import {configureLocalLens} from '../src/services/LocalWifiLens';
import {scanLensNetworks} from '../src/services/scanLensNetworks';

jest.mock('react-native-wifi-reborn', () => ({
  getCurrentWifiSSID: jest.fn().mockResolvedValue('another-network'),
  connectToProtectedWifiSSID: jest.fn().mockResolvedValue(undefined),
  forceWifiUsageWithOptions: jest.fn().mockResolvedValue(undefined),
  isEnabled: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/scanLensNetworks', () => ({
  ...jest.requireActual('../src/services/scanLensNetworks'),
  scanLensNetworks: jest.fn(),
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
  (WifiManager.isEnabled as jest.Mock).mockReset().mockResolvedValue(true);
  (WifiManager.getCurrentWifiSSID as jest.Mock).mockResolvedValue('another-network');
  (scanLensNetworks as jest.Mock).mockReset().mockResolvedValue([]);
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

it('keeps the own-phone hotspot intact after a failed status request with client Wi-Fi off', async () => {
  (WifiManager.isEnabled as jest.Mock).mockResolvedValue(false);
  // Android may retain an old SSID/scan result even with station Wi-Fi off.
  (WifiManager.getCurrentWifiSSID as jest.Mock).mockResolvedValue('My phone');
  (scanLensNetworks as jest.Mock).mockResolvedValue([{ssid: 'My phone', signal: -40}]);
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('radio busy'));
  const pair = await configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot');
  expect(pair.networkType).toBe('hotspot');
  expect(scanLensNetworks).not.toHaveBeenCalled();
  expect(WifiManager.getCurrentWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.disconnect).not.toHaveBeenCalled();
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});

it('joins another phone hotspot when client Wi-Fi is on and the network is visible', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('not joined yet'));
  (scanLensNetworks as jest.Mock).mockResolvedValue([{ssid: 'My phone', signal: -40}]);
  await configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot', 'other-phone');
  expect(WifiManager.connectToProtectedWifiSSID).toHaveBeenCalledWith(expect.objectContaining({ssid: 'My phone'}));
});

it('never joins its own hotspot even on phones that keep client Wi-Fi enabled', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('temporary video congestion'));
  (scanLensNetworks as jest.Mock).mockResolvedValue([{ssid: 'My phone', signal: -30}]);
  const pair = await configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot', 'this-phone');
  expect(pair).toMatchObject({networkType: 'hotspot', ssid: 'My phone', hotspotSource: 'this-phone'});
  expect(WifiManager.isEnabled).not.toHaveBeenCalled();
  expect(WifiManager.getCurrentWifiSSID).not.toHaveBeenCalled();
  expect(scanLensNetworks).not.toHaveBeenCalled();
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.disconnect).not.toHaveBeenCalled();
  expect((WifiManager.forceWifiUsageWithOptions as jest.Mock).mock.calls.every(([enabled]) => !enabled)).toBe(true);
});

it('does not enable client Wi-Fi if the hotspot disables it while scanning', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('radio busy'));
  (scanLensNetworks as jest.Mock).mockImplementation(async () => {
    (WifiManager.isEnabled as jest.Mock).mockResolvedValue(false);
    return [{ssid: 'My phone', signal: -40}];
  });
  await configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot');
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.disconnect).not.toHaveBeenCalled();
});

it('retries local access without changing Wi-Fi when its state cannot be read', async () => {
  (WifiManager.isEnabled as jest.Mock).mockRejectedValue(new Error('unavailable'));
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('radio busy'));
  await configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot');
  expect(scanLensNetworks).not.toHaveBeenCalled();
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.disconnect).not.toHaveBeenCalled();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

it('does not report a BLE-configured hotspot connected until the lens answers locally', async () => {
  jest.useFakeTimers();
  (WifiManager.isEnabled as jest.Mock).mockResolvedValue(false);
  (global.fetch as jest.Mock).mockRejectedValue(new Error('lens unreachable'));
  const assertion = expect(configureLocalLens(null, 'My phone', 'test-password', jest.fn(), new AbortController().signal, 'hotspot'))
    .rejects.toThrow('No se pudo acceder a los lentes');
  await jest.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(WifiManager.connectToProtectedWifiSSID).not.toHaveBeenCalled();
  expect(WifiManager.disconnect).not.toHaveBeenCalled();
  expect(scanLensNetworks).not.toHaveBeenCalled();
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
