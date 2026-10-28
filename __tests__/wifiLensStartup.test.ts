import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {useWifiLensConnection} from '../src/context/useWifiLensConnection';

const mockListeners = new Set<(state: string) => void>();
const mockManager = {
  state: {}, setMode: jest.fn(), poll: jest.fn(), refresh: jest.fn(),
  foreground: jest.fn(), cancel: jest.fn(), networksChanged: jest.fn(),
};
jest.mock('react-native', () => ({AppState: {
  currentState: 'active',
  addEventListener: (_: string, listener: (state: string) => void) => {
    mockListeners.add(listener);
    return {remove: () => mockListeners.delete(listener)};
  },
}}));
jest.mock('react-native-wifi-reborn', () => ({}));
jest.mock('../src/services/LocalWifiLens', () => ({}));
jest.mock('../src/services/scanLensNetworks', () => ({}));
jest.mock('../src/context/useWifiLensAnnouncements', () => ({useWifiLensAnnouncements: () => {}}));
jest.mock('../src/services/SavedNetworksService', () => ({subscribe: () => () => {}}));
jest.mock('../src/services/WifiLensConnectionManager', () => ({WifiLensConnectionManager: jest.fn(() => mockManager)}));

function Screen({initialized}: {initialized: boolean}) {
  useWifiLensConnection(initialized, 'wifi', initialized);
  return null;
}
it('starts once after initialization with the usual connection modal', async () => {
  jest.useFakeTimers();
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  const errors = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
    originalError(message, ...args);
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {renderer = create(React.createElement(Screen, {initialized: false}));});
    expect(mockManager.refresh).not.toHaveBeenCalled();
    await act(async () => {renderer!.update(React.createElement(Screen, {initialized: true}));});
    expect(mockManager.refresh).toHaveBeenCalledWith(false, true);
    await act(async () => {
      mockListeners.forEach(listener => listener('background'));
      mockListeners.forEach(listener => listener('active'));
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(mockManager.refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {renderer?.unmount();});
    await jest.advanceTimersByTimeAsync(0);
    expect(mockListeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    errors.mockRestore();
    jest.useRealTimers();
  }
});
