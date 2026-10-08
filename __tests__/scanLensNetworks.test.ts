import {PermissionsAndroid, Platform} from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import {scanLensNetworks} from '../src/services/scanLensNetworks';
jest.mock('react-native-wifi-reborn', () => ({reScanAndLoadWifiList: jest.fn(), loadWifiList: jest.fn()}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
});
afterEach(() => jest.restoreAllMocks());
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
