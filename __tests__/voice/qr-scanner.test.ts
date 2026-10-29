import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CameraView, scanFromURLAsync } from 'expo-camera';
import { Linking, NativeModules, Platform } from 'react-native';
import QrScannerScreen from '../../src/app/qr-scanner';
import { useVoiceActions } from '../../src/context/voice-commands-context';
import { getJson } from '../../src/lib/api';
import { speak } from '../../src/lib/voice';
import SavedNetworksService from '../../src/services/SavedNetworksService';

const mockConnect = jest.fn(); const mockCapture = jest.fn();
const mockLensState = { phase: 'idle' };
jest.mock('expo-router', () => ({ router: { back: jest.fn() }, usePathname: () => '/qr-scanner', useIsFocused: () => true, useLocalSearchParams: () => ({}) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: {}, View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (s: unknown) => s, absoluteFill: {} }, AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) }, Linking: { openURL: jest.fn(), openSettings: jest.fn() } }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', scanFromURLAsync: jest.fn(), useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('../../src/context/wifi-lens-context', () => ({ useWifiLens: () => ({ wifiLensConnection: mockLensState, connect: mockConnect }) }));
jest.mock('../../src/context/voice-commands-context', () => ({ useVoiceActions: jest.fn() }));
jest.mock('../../src/lib/api', () => ({ getJson: jest.fn() }));
jest.mock('../../src/lib/voice', () => ({ speak: jest.fn() }));
jest.mock('../../src/services/SavedNetworksService', () => ({ __esModule: true, default: { getAll: jest.fn(), add: jest.fn() } }));
jest.mock('../../src/components/WifiLensCamera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: function Lens({ ref, onReady }: { ref: React.Ref<unknown>; onReady: (ready: boolean) => void }) {
    React.useImperativeHandle(ref, () => ({ capture: mockCapture }), []);
    React.useEffect(() => { onReady(true); }, [onReady]); return null;
  } };
});
let tree: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks(); Platform.OS = 'android'; delete NativeModules.AnnyLensBarcode; mockLensState.phase = 'idle';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (SavedNetworksService.getAll as jest.Mock).mockResolvedValue([]);
  (SavedNetworksService.add as jest.Mock).mockResolvedValue({ id: 'network', ssid: 'Casa', password: 'secret', type: 'wifi' });
  (getJson as jest.Mock).mockReset().mockResolvedValue({ product: { desc: 'Leche', marca: 'Marca' } });
  (scanFromURLAsync as jest.Mock).mockReset().mockResolvedValue([]);
});
afterEach(async () => { await act(async () => tree.unmount()); });
async function open() { await act(async () => { tree = create(React.createElement(QrScannerScreen)); }); }
async function scan(data: string) { await act(async () => { tree.root.findByType(CameraView).props.onBarcodeScanned({ data }); }); }
it('looks up and reads the same product fields as v3 and accepts only one scan until retry', async () => {
  await open(); const read = tree.root.findByType(CameraView).props.onBarcodeScanned;
  await act(async () => { read({ data: '779123' }); read({ data: '779123' }); });
  expect(getJson).toHaveBeenCalledTimes(1); expect(getJson).toHaveBeenCalledWith('/api/product/779123');
  expect(speak).toHaveBeenCalledWith('Esto es Leche de marca Marca.');
  await act(async () => { (useVoiceActions as jest.Mock).mock.calls.at(-1)[0].repeat(); });
  await scan('779124'); expect(getJson).toHaveBeenCalledTimes(2);
});
it('saves and connects a WiFi QR without announcing its password', async () => {
  await open(); await scan('WIFI:T:WPA;S:Casa;P:secret;;');
  expect(SavedNetworksService.add).toHaveBeenCalledWith('Casa', 'secret', 'wifi');
  expect(mockConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'network', ssid: 'Casa' }));
  expect((speak as jest.Mock).mock.calls.every(([text]) => !text.includes('secret'))).toBe(true);
  expect(getJson).not.toHaveBeenCalled();
});
it('opens web QR codes and reports unknown barcodes in Spanish', async () => {
  await open(); await scan('https://example.com'); expect(Linking.openURL).toHaveBeenCalledWith('https://example.com');
  await act(async () => { (useVoiceActions as jest.Mock).mock.calls.at(-1)[0].repeat(); });
  (getJson as jest.Mock).mockRejectedValueOnce(new Error('Request failed: 404'));
  await scan('unknown'); expect(speak).toHaveBeenCalledWith('No se ha encontrado este producto en nuestra base de datos.');
});
it('scans the locally captured lens JPEG with the native decoder', async () => {
  mockLensState.phase = 'connected'; mockCapture.mockResolvedValue('lens-frame');
  (scanFromURLAsync as jest.Mock).mockResolvedValue([{ data: '779123' }]);
  await open();
  expect(scanFromURLAsync).toHaveBeenCalledWith('data:image/jpeg;base64,lens-frame', expect.arrayContaining(['qr', 'ean13']));
  expect(getJson).toHaveBeenCalledWith('/api/product/779123');
});
it('uses Vision to recognize product barcodes from lens images on iOS', async () => {
  Platform.OS = 'ios'; mockLensState.phase = 'connected'; mockCapture.mockResolvedValue('lens-frame');
  const scan = jest.fn().mockResolvedValue([{ type: 'ean13', data: '779123' }]);
  NativeModules.AnnyLensBarcode = { scan };
  await open();
  expect(scan).toHaveBeenCalledWith('lens-frame');
  expect(scanFromURLAsync).not.toHaveBeenCalled();
  expect(getJson).toHaveBeenCalledWith('/api/product/779123');
});
it('does not process a frame that completes after leaving the scanner', async () => {
  mockLensState.phase = 'connected'; let finish!: (image: string) => void;
  mockCapture.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  await open(); await act(async () => tree.unmount()); await act(async () => { finish('late-frame'); });
  expect(scanFromURLAsync).not.toHaveBeenCalled(); expect(getJson).not.toHaveBeenCalled();
});
