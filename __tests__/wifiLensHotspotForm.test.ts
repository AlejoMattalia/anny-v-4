import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {WifiLensNetworks} from '../src/components/wifi-lens-networks';
import SavedNetworksService from '../src/services/SavedNetworksService';
import {scanLensNetworks} from '../src/services/scanLensNetworks';

jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Modal: 'Modal',
  StyleSheet: {create: (styles: unknown) => styles},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: 'SafeAreaView'}));
jest.mock('expo-router', () => ({router: {}}));
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('../src/components/wifi-lens-connection-card', () => ({WifiLensConnectionCard: () => null}));
jest.mock('../src/context/wifi-lens-context', () => ({useWifiLens: () => ({
  networks: [], networkPreference: 'hotspot', wifiLensConnection: {phase: 'disconnected'},
  connect: jest.fn(), manager: {},
})}));
jest.mock('../src/services/SavedNetworksService', () => ({__esModule: true, default: {add: jest.fn().mockResolvedValue(undefined)}}));
jest.mock('../src/services/scanLensNetworks', () => ({scanLensNetworks: jest.fn().mockResolvedValue([])}));
jest.mock('../src/services/LensAutoProvisioning', () => ({validateLensWifi: jest.fn()}));
jest.mock('../src/lib/voice', () => ({speak: jest.fn()}));

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
async function press(text: string) {
  const button = renderer.root.findAllByType(Pressable).find(node => node.findAllByType(Text).some(label => label.props.children === text));
  expect(button).toBeDefined();
  await act(async () => {button!.props.onPress();});
}
beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {renderer = create(React.createElement(WifiLensNetworks));});
  await press('Agregar red');
  await act(async () => {
    renderer.root.findByProps({accessibilityLabel: 'Nombre de red'}).props.onChangeText('Phone');
    renderer.root.findByProps({accessibilityLabel: 'Contraseña de la red'}).props.onChangeText('test-password');
  });
});
afterEach(async () => {await act(async () => {renderer.unmount();});});

it('adds this phone hotspot without scanning and persists the explicit source', async () => {
  const own = renderer.root.findAllByProps({accessibilityRole: 'radio'})[0];
  expect(own.props.accessibilityState.checked).toBe(true);
  await press('Guardar');
  expect(scanLensNetworks).not.toHaveBeenCalled();
  expect(SavedNetworksService.add).toHaveBeenCalledWith('Phone', 'test-password', 'hotspot', 'this-phone');
});

it('offers scanning only after selecting another phone and saves that choice', async () => {
  await press('Otro celular');
  await press('Buscar hotspot de otro celular');
  expect(scanLensNetworks).toHaveBeenCalledTimes(1);
  await press('Guardar');
  expect(SavedNetworksService.add).toHaveBeenCalledWith('Phone', 'test-password', 'hotspot', 'other-phone');
});
