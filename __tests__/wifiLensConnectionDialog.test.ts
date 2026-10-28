import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {WifiLensProvider} from '../src/context/wifi-lens-context';

const mockManager = {restoreDisconnected: jest.fn(), disconnect: jest.fn().mockResolvedValue(undefined), refreshStatus: jest.fn()};
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: {create: (value: unknown) => value},
}));
jest.mock('expo-router', () => ({router: {}}));
jest.mock('../src/context/assistance-context', () => ({useAssistance: () => ({role: 'PDV', authLoaded: true})}));
jest.mock('../src/context/useWifiLensConnection', () => ({useWifiLensConnection: () => ({
  connection: {phase: 'connecting', showDialog: true, message: 'Buscando tus lentes…'}, manager: mockManager,
})}));
jest.mock('../src/services/SavedNetworksService', () => ({
  getAll: async () => [], getPreference: async () => 'wifi', getDisconnected: async () => false, subscribe: () => () => {},
}));
jest.mock('../src/services/migrateWifiLens', () => ({migrateWifiLens: async () => {}}));

it('Cancel suspends the search and recovery instead of starting another status probe', async () => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  const errors = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
    originalError(message, ...args);
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {renderer = create(React.createElement(WifiLensProvider));});
    const cancel = renderer!.root.findAllByType(Pressable).find(button =>
      button.findAllByType(Text).some(text => text.props.children === 'Cancelar'));
    expect(cancel).toBeDefined();
    await act(async () => {cancel!.props.onPress();});
    expect(mockManager.disconnect).toHaveBeenCalledTimes(1);
    expect(mockManager.refreshStatus).not.toHaveBeenCalled();
  } finally {
    await act(async () => {renderer?.unmount();});
    errors.mockRestore();
  }
});
