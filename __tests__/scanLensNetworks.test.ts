import {PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import {scanLensNetworks} from '../src/services/scanLensNetworks';
jest.mock('react-native-wifi-reborn', () => ({getCurrentWifiSSID: jest.fn(), isEnabled: jest.fn(), reScanAndLoadWifiList: jest.fn(), loadWifiList: jest.fn()}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  (WifiManager.isEnabled as jest.Mock).mockReset().mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
it('uses only the current SSID on iOS without invoking Android scan APIs', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  (WifiManager.getCurrentWifiSSID as jest.Mock).mockResolvedValue('"Casa"');
  await expect(scanLensNetworks()).resolves.toEqual([{ssid: 'Casa', signal: -100}]);
  expect(WifiManager.reScanAndLoadWifiList).not.toHaveBeenCalled();
  expect(WifiManager.loadWifiList).not.toHaveBeenCalled();
  expect(PermissionsAndroid.check).not.toHaveBeenCalled();
});
it.each(['', '<unknown ssid>'])('leaves saved-network fallback available when iOS hides the SSID (%s)', async value => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  (WifiManager.getCurrentWifiSSID as jest.Mock).mockResolvedValue(value);
  await expect(scanLensNetworks()).resolves.toEqual([]);
});
it('bounds an unresponsive iOS SSID query', async () => {
  jest.useFakeTimers(); jest.replaceProperty(Platform, 'OS', 'ios');
  (WifiManager.getCurrentWifiSSID as jest.Mock).mockReturnValue(new Promise(() => {}));
  const result = scanLensNetworks(); await jest.advanceTimersByTimeAsync(8000);
  await expect(result).resolves.toEqual([]); expect(jest.getTimerCount()).toBe(0);
});
it('does not scan or use cached networks while client Wi-Fi is off for a hotspot', async () => {
  (WifiManager.isEnabled as jest.Mock).mockResolvedValue(false);
  await expect(scanLensNetworks()).resolves.toEqual([]);
  expect(WifiManager.reScanAndLoadWifiList).not.toHaveBeenCalled();
  expect(WifiManager.loadWifiList).not.toHaveBeenCalled();
  expect(PermissionsAndroid.check).not.toHaveBeenCalled();
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});
it('requests a fresh scan and keeps signal and frequency for network selection', async () => {
  (WifiManager.reScanAndLoadWifiList as jest.Mock).mockResolvedValue(JSON.stringify([{SSID: 'Home', level: -43, frequency: 2412}, {SSID: ''}]));
  expect(await scanLensNetworks()).toEqual([{ssid: 'Home', signal: -43, frequency: 2412}]);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});
it('uses Android scan results when fresh scanning is throttled', async () => {
  (WifiManager.reScanAndLoadWifiList as jest.Mock).mockRejectedValue(new Error('throttled'));
  (WifiManager.loadWifiList as jest.Mock).mockResolvedValue([{SSID: 'Home', level: -72, frequency: 2412}]);
  expect(await scanLensNetworks()).toEqual([{ssid: 'Home', signal: -72, frequency: 2412}]);
});
it('reports permission denial without trying to scan', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  await expect(scanLensNetworks()).rejects.toThrow('Permití ubicación');
  expect(WifiManager.reScanAndLoadWifiList).not.toHaveBeenCalled();
});

it('recovers when Android never completes the fresh scan', async () => {
  jest.useFakeTimers();
  (WifiManager.reScanAndLoadWifiList as jest.Mock).mockReturnValue(new Promise(() => {}));
  (WifiManager.loadWifiList as jest.Mock).mockResolvedValue([{SSID: 'Home', level: -72, frequency: 2412}]);
  const pending = scanLensNetworks();
  await jest.advanceTimersByTimeAsync(8000);
  await expect(pending).resolves.toEqual([{ssid: 'Home', signal: -72, frequency: 2412}]);
  expect(jest.getTimerCount()).toBe(0);
});

it('uses cached results when the native module resolves its throttling message', async () => {
  (WifiManager.reScanAndLoadWifiList as jest.Mock).mockResolvedValue("Starting Android 9, it's only allowed to scan 4 times per 2 minuts in a foreground app.");
  (WifiManager.loadWifiList as jest.Mock).mockResolvedValue(JSON.stringify([{SSID: 'Home', level: -72, frequency: 2412}]));
  await expect(scanLensNetworks()).resolves.toEqual([{ssid: 'Home', signal: -72, frequency: 2412}]);
});
