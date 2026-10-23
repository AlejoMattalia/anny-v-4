import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {AppState} from 'react-native';
import WifiLensCamera from '../src/components/WifiLensCamera';
import LocalWifiLens from '../src/components/LocalWifiLens';
import {findLocalLens} from '../src/services/LocalWifiLens';
import {WifiLensContext} from '../src/context/wifi-lens-context';
import {stopGlassesStreamingService} from '../src/services/GlassesStreamingService';
import type {WifiLensCameraHandle} from '../src/components/WifiLensCamera';

const mockAppListeners = new Set<(state: string) => void>();
const mockPair = {address: 'http://192.168.43.25', ap: 'Lentes-123abc', password: 'device', networkType: 'hotspot'};
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: {create: (styles: unknown) => styles},
  AppState: {
    currentState: 'active',
    addEventListener: (_name: string, listener: (state: string) => void) => {
      mockAppListeners.add(listener);
      return {remove: () => mockAppListeners.delete(listener)};
    },
  },
}));
jest.mock('expo-router', () => ({useIsFocused: () => true}));
jest.mock('../src/components/LocalWifiLens', () => jest.fn(() => null));
jest.mock('../src/context/wifi-lens-context', () => ({
  WifiLensContext: jest.requireActual<typeof import('react')>('react').createContext({
    wifiLensConnection: {enabled: true, manuallyDisconnected: false, phase: 'connected', ssid: 'Phone'},
    trackWifiLensCamera: jest.fn().mockResolvedValue(jest.fn()),
  }),
}));
jest.mock('../src/services/LocalWifiLens', () => ({
  loadLensPairing: jest.fn(async () => mockPair),
  findLocalLens: jest.fn(),
  saveLensPairing: jest.fn().mockResolvedValue(undefined),
  releaseLensNetwork: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/LocalLensTransport', () => ({hasLocalLensTransport: () => false}));
jest.mock('../src/services/WifiLensCamera', () => ({captureWifiLens: jest.fn()}));
jest.mock('../src/services/GlassesStreamingService', () => ({
  startGlassesStreamingService: jest.fn().mockResolvedValue(undefined),
  stopGlassesStreamingService: jest.fn().mockResolvedValue(undefined),
}));

let renderer: ReactTestRenderer;
let onReady: jest.Mock;
const originalError = console.error;
beforeAll(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) {return;}
    originalError(message, ...args);
  });
});
afterAll(() => {jest.restoreAllMocks();});
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = 'active';
  (findLocalLens as jest.Mock).mockReset().mockResolvedValue({address: mockPair.address, state: {camera: true, connected: true, ssid: 'Phone'}});
  onReady = jest.fn();
  await act(async () => {renderer = create(React.createElement(WifiLensCamera, {onReady}));});
});
afterEach(async () => {
  await act(async () => {renderer.unmount();});
  await jest.advanceTimersByTimeAsync(0);
  expect(mockAppListeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

async function frame() {
  await act(async () => {renderer.root.findByType(LocalWifiLens).props.onStreamFrame();});
}
async function advance(ms: number) {
  await act(async () => {await jest.advanceTimersByTimeAsync(ms);});
}
async function appState(state: 'active' | 'background') {
  await act(async () => {
    AppState.currentState = state;
    mockAppListeners.forEach(listener => listener(state));
  });
}

it('marks a stalled hotspot camera unavailable and reopens its local video', async () => {
  await act(async () => {renderer.root.findByType(LocalWifiLens).props.onStreamReady();});
  expect(onReady).toHaveBeenLastCalledWith(true);
  await advance(15000);
  expect(onReady).toHaveBeenLastCalledWith(false);
  expect(findLocalLens).toHaveBeenCalledTimes(2);
  expect(findLocalLens).toHaveBeenLastCalledWith(mockPair, expect.any(AbortSignal));
  await act(async () => {renderer.root.findByType(LocalWifiLens).props.onStreamReady();});
  expect(onReady).toHaveBeenLastCalledWith(true);
});

it('keeps a stream receiving frames and retries only after a full gap', async () => {
  for (let index = 0; index < 4; index++) {await advance(10000); await frame();}
  await advance(14999);
  expect(findLocalLens).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(findLocalLens).toHaveBeenCalledTimes(2);
});

it('recovers a video that never delivers its first frame', async () => {
  await advance(15000);
  expect(findLocalLens).toHaveBeenCalledTimes(2);
  expect(onReady).not.toHaveBeenCalledWith(true);
});

it('does not restart a background stream and gives it time to resume', async () => {
  await advance(10000);
  await appState('background');
  await advance(60000);
  expect(findLocalLens).toHaveBeenCalledTimes(1);
  await appState('active');
  await advance(14999);
  expect(findLocalLens).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(findLocalLens).toHaveBeenCalledTimes(2);
});

it('stops automatic video retries when the lens is no longer reachable', async () => {
  (findLocalLens as jest.Mock).mockRejectedValueOnce(new Error('Lente fuera de alcance'));
  await advance(15000);
  expect(renderer.root.findAllByType(LocalWifiLens)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Lente fuera de alcance');
  await advance(60000);
  expect(findLocalLens).toHaveBeenCalledTimes(2);
});

it('cancels frame monitoring when the camera is paused', async () => {
  await act(async () => {renderer.update(React.createElement(WifiLensCamera, {onReady, active: false}));});
  await advance(60000);
  expect(findLocalLens).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenLastCalledWith(false);
});

it('closes the native stream and background service and blocks capture after manual disconnect', async () => {
  const ref = React.createRef<WifiLensCameraHandle>();
  let connection: {enabled: boolean; manuallyDisconnected: boolean; phase: string; ssid: string} | undefined;
  function Screen() {
    const current = React.useContext(WifiLensContext);
    return React.createElement(WifiLensContext.Provider, {
      value: {...current, wifiLensConnection: {...current.wifiLensConnection, ...connection} as typeof current.wifiLensConnection},
    }, React.createElement(WifiLensCamera, {ref, onReady}));
  }
  await act(async () => {renderer.update(React.createElement(Screen));});
  await frame();
  const probes = (findLocalLens as jest.Mock).mock.calls.length;
  (stopGlassesStreamingService as jest.Mock).mockClear();
  connection = {enabled: true, manuallyDisconnected: true, phase: 'disconnected', ssid: ''};
  await act(async () => {renderer.update(React.createElement(Screen));});
  expect(renderer.root.findAllByType(LocalWifiLens)).toHaveLength(0);
  expect(stopGlassesStreamingService).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenLastCalledWith(false);
  await expect(ref.current!.capture()).rejects.toThrow('Esperá a que se conecte');
  await appState('background');
  await appState('active');
  await advance(60000);
  expect(findLocalLens).toHaveBeenCalledTimes(probes);
  expect(JSON.stringify(renderer.toJSON())).toContain('Lentes desconectados');
});

it('does not contact the lens before startup has restored the connection preference', async () => {
  function Screen() {
    const current = React.useContext(WifiLensContext);
    return React.createElement(WifiLensContext.Provider, {
      value: {...current, wifiLensConnection: {...current.wifiLensConnection, enabled: false}},
    }, React.createElement(WifiLensCamera, {onReady}));
  }
  (findLocalLens as jest.Mock).mockClear();
  await act(async () => {renderer.update(React.createElement(Screen));});
  await advance(60000);
  expect(findLocalLens).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(LocalWifiLens)).toHaveLength(0);
});
