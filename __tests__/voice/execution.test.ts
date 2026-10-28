import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { VoiceCommandsProvider, useVoiceActions, useVoiceCommands } from '../../src/context/voice-commands-context';
import { listenOnce, speak } from '../../src/lib/voice';
import { useWifiLensButtons } from '../../src/context/useWifiLensButtons';

const mockAssistance = { user: { _id: 'pdv', roles: [{ name: 'PDV' }] } as { _id: string; roles: { name: string }[] } | null,
  role: 'PDV', request: jest.fn(), cancel: jest.fn(), endCall: jest.fn() };
const mockLens = { wifiLensConnection: { phase: 'connected', manuallyDisconnected: false, session: null }, networkPreference: 'wifi',
  setNetworkPreference: jest.fn(), manager: { refresh: jest.fn() } };
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), dismissAll: jest.fn(), canGoBack: () => true, back: jest.fn() }, usePathname: () => '/home', useIsFocused: () => true }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) }, Linking: { openURL: jest.fn() } }));
jest.mock('../../src/context/assistance-context', () => ({ useAssistance: () => mockAssistance }));
jest.mock('../../src/context/wifi-lens-context', () => ({ useWifiLens: () => mockLens }));
jest.mock('../../src/context/useWifiLensButtons', () => ({ useWifiLensButtons: jest.fn() }));
jest.mock('../../src/lib/current-location', () => ({ getExplorationLocation: jest.fn().mockResolvedValue({ latitude: -31, longitude: -64 }), reverseGeocodeLocation: jest.fn().mockResolvedValue('Plaza San Martín, Córdoba') }));
jest.mock('../../src/lib/voice', () => ({ listenOnce: jest.fn(), getLastSpokenText: () => 'Última indicación', setGuidancePaused: jest.fn(), speak: jest.fn(), stopListening: jest.fn(), stopSpeaking: jest.fn() }));
let voice: ReturnType<typeof useVoiceCommands>;
let tree: ReactTestRenderer;
const repeatScan = jest.fn(); const nextStep = jest.fn(); const boardBus = jest.fn();
function Probe() {
  const context = useVoiceCommands();
  React.useEffect(() => { voice = context; });
  useVoiceActions({ repeat: repeatScan, next_step: nextStep, board_bus: boardBus });
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockAssistance.user = { _id: 'pdv', roles: [{ name: 'PDV' }] }; mockAssistance.role = 'PDV';
  mockLens.networkPreference = 'wifi'; mockLens.wifiLensConnection.manuallyDisconnected = false;
  await act(async () => { tree = create(React.createElement(VoiceCommandsProvider, null, React.createElement(Probe))); });
});
afterEach(async () => { await act(async () => tree.unmount()); });
const execute = async (text: string) => { await act(async () => { await voice.execute(text); }); };
it('opens natural conversation and avoids a second TTS voice for conversational actions', async () => {
  await execute('hablar con anny');
  expect(router.navigate).toHaveBeenCalledWith('/conversation');
  await act(async () => { await voice.execute('dónde estoy', { silent: true }); });
  expect(speak).not.toHaveBeenCalled();
});
it.each([
  ['texto', '/visual-scanner', { mode: 'read_text' }],
  ['billete', '/visual-scanner', { mode: 'identify_currency' }],
  ['imagen', '/visual-scanner', { mode: 'describe_scene' }],
  ['modo supermercado', '/realtime-streaming', { streamingMode: 'supermercado' }],
  ['iniciar detección', '/realtime-streaming', { detection: '1' }],
  ['personal', '/profile', { edit: '1' }],
])('connects %s to its actual screen behavior', async (text, pathname, params) => {
  await execute(text); expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({ pathname, params: expect.objectContaining(params) }));
});
it('requests tutor assistance rather than just opening the help page', async () => {
  await execute('ayuda'); expect(router.navigate).toHaveBeenCalledWith('/remote-assistance'); expect(mockAssistance.request).toHaveBeenCalledTimes(1);
});
it('dispatches repeat, stages and boarding to the active screen actions', async () => {
  await execute('repetir'); await execute('siguiente etapa'); await execute('subí al colectivo');
  expect(repeatScan).toHaveBeenCalledTimes(1); expect(nextStep).toHaveBeenCalledTimes(1); expect(boardBus).toHaveBeenCalledTimes(1);
  expect(router.navigate).not.toHaveBeenCalled();
});
it('prepares the spoken destination and selected transport without losing either', async () => {
  await execute('ir a Hospital Córdoba en colectivo');
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/plan-trip', params: expect.objectContaining({ destination: 'Hospital Córdoba', travelMode: 'transit' }) }));
});
it('connects saved WiFi networks, and reconnects when explicitly requested after disconnection', async () => {
  await execute('conectar wifi'); expect(mockLens.setNetworkPreference).toHaveBeenCalledWith('wifi'); expect(mockLens.manager.refresh).toHaveBeenCalledWith(true, true);
  jest.clearAllMocks(); mockLens.wifiLensConnection.manuallyDisconnected = true;
  await execute('conectar hotspot'); expect(mockLens.setNetworkPreference).toHaveBeenCalledWith('hotspot'); expect(mockLens.manager.refresh).toHaveBeenCalledWith(true, true);
});
it('reads the current address without leaving navigation', async () => {
  await execute('dónde estoy'); expect(speak).toHaveBeenCalledWith('Estás en Plaza San Martín, Córdoba'); expect(router.navigate).not.toHaveBeenCalled();
});
it('opens the same external services as v3', async () => {
  await execute('radio'); await execute('audiolibro');
  expect(Linking.openURL).toHaveBeenCalledWith('https://es.streema.com/radios/LRK1063_Gamba_FM_106.3_FM');
  expect(Linking.openURL).toHaveBeenCalledWith('https://www.audible.com/');
});
it('cleans up assistance and returns home on salir', async () => {
  await execute('salir'); expect(mockAssistance.cancel).toHaveBeenCalled(); expect(mockAssistance.endCall).toHaveBeenCalled(); expect(router.dismissAll).toHaveBeenCalled(); expect(router.replace).toHaveBeenCalledWith('/home');
});
it('blocks restricted commands and any command after logout', async () => {
  mockAssistance.user = { _id: 'tutor', roles: [{ name: 'TUTOR' }] }; mockAssistance.role = 'TUTOR';
  await execute('texto'); expect(router.navigate).not.toHaveBeenCalled(); expect(speak).toHaveBeenCalledWith('Tu cuenta no tiene acceso a esta función.');
  mockAssistance.user = null; await execute('contactos'); expect(router.navigate).not.toHaveBeenCalled();
});
it('executes recognized commands from the physical lens button through the same controller', async () => {
  (listenOnce as jest.Mock).mockResolvedValueOnce('Anny contactos');
  await act(async () => { (useWifiLensButtons as jest.Mock).mock.calls.at(-1)[1](); });
  expect(listenOnce).toHaveBeenCalledWith(expect.objectContaining({ contextualStrings: expect.arrayContaining(['contactos', 'cancelar viaje', 'iniciar detección']) }));
  expect(router.navigate).toHaveBeenCalledWith('/contacts');
});
it('does not execute a late transcript after the user cancels the microphone', async () => {
  let finish!: (text: string) => void;
  (listenOnce as jest.Mock).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = voice.listen(); });
  expect(voice.listening).toBe(true);
  await act(async () => { voice.cancel(); finish('ayuda'); await pending; });
  expect(voice.listening).toBe(false); expect(mockAssistance.request).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
});
