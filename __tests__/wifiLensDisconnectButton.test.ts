import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {WifiLensConnectionCard} from '../src/components/wifi-lens-connection-card';

const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(true);
const mockConnection = {phase: 'connected', ssid: 'Phone', session: {networkType: 'hotspot'}, manuallyDisconnected: false, message: ''};
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  View: 'View', Text: 'Text', Pressable: 'Pressable', Switch: 'Switch',
  StyleSheet: {create: (styles: unknown) => styles},
}));
jest.mock('expo-router', () => ({router: {push: jest.fn()}}));
jest.mock('../src/context/wifi-lens-context', () => ({useWifiLens: () => ({
  wifiLensConnection: mockConnection, networkPreference: 'hotspot',
  setNetworkPreference: jest.fn(), disconnect: mockDisconnect, manager: {refresh: mockRefresh},
})}));

let renderer: ReactTestRenderer;
const originalError = console.error;
beforeAll(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
    originalError(message, ...args);
  });
});
afterAll(() => {jest.restoreAllMocks();});
beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.phase = 'connected';
  mockConnection.manuallyDisconnected = false;
});
afterEach(async () => {await act(async () => {renderer.unmount();});});

it.each([false, true])('disconnects the connected lens from the card (compact=%s)', async compact => {
  await act(async () => {renderer = create(React.createElement(WifiLensConnectionCard, {compact}));});
  const button = renderer.root.findByProps({accessibilityLabel: 'Desconectar lentes'});
  await act(async () => {await button.props.onPress();});
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('offers explicit reconnect after disconnecting and hides the disconnect action', async () => {
  mockConnection.phase = 'disconnected';
  mockConnection.manuallyDisconnected = true;
  await act(async () => {renderer = create(React.createElement(WifiLensConnectionCard));});
  expect(renderer.root.findAllByProps({accessibilityLabel: 'Desconectar lentes'})).toHaveLength(0);
  await act(async () => {renderer.root.findByProps({accessibilityLabel: 'Conectar lentes'}).props.onPress();});
  expect(mockRefresh).toHaveBeenCalledWith(true, true);
});
