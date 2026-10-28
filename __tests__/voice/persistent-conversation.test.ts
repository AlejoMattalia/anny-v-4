import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { ConversationProvider, useConversation } from '../../src/context/conversation-context';
import { createVoiceConversation, endVoiceConversation } from '../../src/lib/voice-conversation';
import { getExplorationLocation, reverseGeocodeLocation } from '../../src/lib/current-location';
import { appControl } from '../../src/services/AppControl';
import { stopSpeaking } from '../../src/lib/voice';
import { playConversationConnecting } from '../../src/services/ConversationConnectionCue';
import { ConversationAppService } from '../../src/services/ConversationAppService';
import { relayConversationSpeech } from '../../src/services/ConversationRuntime';

let mockPath = '/conversation';
let mockWebProps: any;
let mockMounts = 0; let mockUnmounts = 0;
const mockInject = jest.fn();
const mockAssistance = { authLoaded: true, user: { _id: 'pdv', roles: [{ name: 'PDV' }] } as any, role: 'PDV', phase: 'idle', request: jest.fn(), respond: jest.fn() };
const mockVoice = { cancel: jest.fn(), execute: jest.fn().mockResolvedValue(true) };
const mockListeners = new Set<(state: string) => void>();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), canGoBack: () => true }, usePathname: () => mockPath }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'Icon' }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', StyleSheet: { create: (s: unknown) => s }, Alert: { alert: jest.fn() }, AppState: { addEventListener: (_: string, listener: (state: string) => void) => { mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) }; } } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../src/context/assistance-context', () => ({ useAssistance: () => mockAssistance }));
jest.mock('../../src/context/voice-commands-context', () => ({ useVoiceCommands: () => mockVoice }));
jest.mock('../../src/context/wifi-lens-context', () => ({ useWifiLens: () => ({ wifiLensConnection: { phase: 'connected' }, networkPreference: 'wifi' }) }));
jest.mock('../../src/lib/current-location', () => ({ getExplorationLocation: jest.fn(), reverseGeocodeLocation: jest.fn() }));
jest.mock('../../src/lib/voice', () => ({ requestConversationMicrophone: jest.fn().mockResolvedValue(undefined), stopListening: jest.fn(), stopSpeaking: jest.fn() }));
jest.mock('../../src/lib/voice-conversation', () => ({ voiceApiUrl: 'https://voice.test', createVoiceConversation: jest.fn(), endVoiceConversation: jest.fn() }));
jest.mock('../../src/lib/settings-storage', () => ({ loadSettings: jest.fn().mockResolvedValue({ voiceRate: 1 }) }));
jest.mock('../../src/lib/auth', () => ({ clearAuthSession: jest.fn() }));
jest.mock('../../src/services/ConversationConnectionCue', () => ({ playConversationConnecting: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/services/ConversationAppService', () => ({ ConversationAppService: jest.fn().mockImplementation(() => ({ run: jest.fn(), beginUserTurn: jest.fn() })) }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { WebView: React.forwardRef((props: any, ref) => {
    mockWebProps = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    React.useEffect(() => { mockMounts++; return () => { mockUnmounts++; }; }, []);
    return React.createElement('VoiceWebView');
  }) };
});
let controls: ReturnType<typeof useConversation>;
function Probe() { controls = useConversation(); return null; }
const loadWebView = () => Promise.resolve(require('react-native-webview'));
const element = () => React.createElement(ConversationProvider, { loadWebView }, React.createElement(Probe));
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
let tree: ReactTestRenderer;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks(); mockPath = '/conversation'; mockMounts = 0; mockUnmounts = 0;
  mockAssistance.user = { _id: 'pdv', roles: [{ name: 'PDV' }] }; mockAssistance.phase = 'idle';
  (createVoiceConversation as jest.Mock).mockResolvedValue({ ticket: 'temporary-ticket', url: 'https://voice.test/', maxSessionSeconds: 600 });
  await act(async () => { tree = create(element()); });
  await act(async () => { controls.start(); await flush(); });
});
afterEach(async () => { await act(async () => tree.unmount()); jest.useRealTimers(); });
async function event(data: unknown) { await act(async () => { await mockWebProps.onMessage({ nativeEvent: { url: 'https://voice.test/', data: JSON.stringify(data) } }); }); }
it('keeps the same WebView and session while the user opens navigation and a camera', async () => {
  await event({ type: 'ready' });
  await event({ type: 'status', text: 'Te escucho', connected: true });
  expect(mockMounts).toBe(1);
  mockPath = '/start-trip'; await act(async () => { tree.update(element()); });
  expect(mockMounts).toBe(1); expect(mockUnmounts).toBe(0);
  mockPath = '/visual-scanner'; await act(async () => { tree.update(element()); });
  expect(mockMounts).toBe(1); expect(mockUnmounts).toBe(0);
  expect(createVoiceConversation).toHaveBeenCalledTimes(1); expect(endVoiceConversation).not.toHaveBeenCalled();
  expect(mockWebProps.style).toMatchObject({ width: 1, height: 1 });
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('setContext("/visual-scanner")'));
});
it('shows no native conversation texts or labels on the screen', async () => {
  await event({ type: 'ready' }); await event({ type: 'status', text: 'Anny está hablando', connected: true });
  expect(tree.root.findAllByType(Text)).toHaveLength(0);
});
it('reports the current route and real screen state to the ongoing conversation', async () => {
  mockPath = '/start-trip'; const cleanup = appControl.register('/start-trip', () => ({ phase: 'navigating', instruction: 'Girá a la derecha.' }), () => ({}));
  await act(async () => { tree.update(element()); });
  await event({ type: 'tool', id: 'context-1', plan: { type: 'native', name: 'get_app_context', arguments: {} } });
  const script = mockInject.mock.calls.at(-1)?.[0];
  expect(script).toContain('"screen":"/start-trip"'); expect(script).toContain('"phase":"navigating"');
  cleanup();
});
it('pauses audio for a permission dialog and resumes the same conversation afterward', async () => {
  await event({ type: 'ready' });
  await act(async () => { mockListeners.forEach(listener => listener('background')); });
  expect(endVoiceConversation).not.toHaveBeenCalled();
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('setForeground(false)'));
  expect(mockUnmounts).toBe(0);
  await act(async () => { mockListeners.forEach(listener => listener('active')); });
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('setForeground(true)'));
  expect(createVoiceConversation).toHaveBeenCalledTimes(1);
});
it('rejects a model request to end when the person only supplied a destination', async () => {
  await event({ type: 'user_transcript', text: 'Quiero ir a Plaza San Martín caminando.' });
  await event({ type: 'tool', id: 'wrong-end', plan: { type: 'native', name: 'run_app_action', arguments: { action: 'end_conversation', parameters: {} } } });
  expect(controls.running).toBe(true);
  expect(endVoiceConversation).not.toHaveBeenCalled();
  expect(mockInject.mock.calls.at(-1)[0]).toContain('no pidió finalizar');
});
it('ends the voice session when the person explicitly asks for it', async () => {
  await event({ type: 'user_transcript', text: 'Anny, terminá la conversación.' });
  await event({ type: 'tool', id: 'explicit-end', plan: { type: 'native', name: 'run_app_action', arguments: { action: 'end_conversation', parameters: {} } } });
  expect(controls.running).toBe(false);
  expect(endVoiceConversation).toHaveBeenCalledWith('temporary-ticket');
});
it('renews a transport without losing the trip service or ending the conversation', async () => {
  await event({ type: 'ready' });
  const services = (ConversationAppService as jest.Mock).mock.calls.length;
  jest.useFakeTimers();
  await event({ type: 'reconnect', history: [{ role: 'user', text: 'Vamos a la plaza caminando.' }], muted: true });
  expect(controls.running).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(createVoiceConversation).toHaveBeenCalledTimes(2);
  expect((ConversationAppService as jest.Mock).mock.calls.length).toBe(services);
  await event({ type: 'ready' });
  expect(mockInject.mock.calls.at(-1)[0]).toContain('Vamos a la plaza caminando.');
});
it('forwards streaming speech with priority to the persistent voice page', async () => {
  await event({ type: 'status', text: 'Te escucho', connected: true });
  let pending!: Promise<boolean>;
  await act(async () => { pending = relayConversationSpeech('Una puerta roja.', { priority: 'stream' }); });
  const script = mockInject.mock.calls.at(-1)[0];
  expect(script).toContain('Una puerta roja.'); expect(script).toContain('"stream"');
  const id = script.match(/narrate\("([^"]+)"/)[1];
  await event({ type: 'narration_done', id });
  await expect(pending).resolves.toBe(true);
});
it('starts preparing the next scene only after the current narration actually starts playing', async () => {
  await event({ type: 'status', text: 'Te escucho', connected: true });
  const onStart = jest.fn();
  const pending = relayConversationSpeech('Puerta al frente.', { priority: 'stream', onStart });
  const script = mockInject.mock.calls.at(-1)[0]; const id = script.match(/narrate\("([^"]+)"/)[1];
  expect(onStart).not.toHaveBeenCalled();
  await event({ type: 'narration_started', id }); expect(onStart).toHaveBeenCalledTimes(1);
  await event({ type: 'narration_done', id }); await pending;
});
it('closing the app account still invalidates the old voice session', async () => {
  mockAssistance.user = null;
  await act(async () => tree.update(element()));
  expect(endVoiceConversation).toHaveBeenCalledWith('temporary-ticket');
});
it('creates the voice session even when Android never acknowledges stopping TTS', async () => {
  await act(async () => controls.stop());
  jest.useFakeTimers(); jest.clearAllMocks();
  (stopSpeaking as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => controls.start());
  expect(createVoiceConversation).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
  expect(createVoiceConversation).toHaveBeenCalledTimes(1);
  expect(mockWebProps.source.uri).toBe('https://voice.test/');
});
it('provides a second page-ready handshake and ignores duplicate ready events', async () => {
  await act(async () => mockWebProps.onLoadEnd());
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining("type:'ready'"));
  mockInject.mockClear();
  await event({ type: 'ready' }); await event({ type: 'ready' });
  expect(mockInject.mock.calls.filter(([script]) => script.includes('AnnyVoice?.start('))).toHaveLength(1);
});

it('offers an explicit icon button that ends the call without holding the circle', async () => {
  const button = tree.root.find(node => node.props.accessibilityLabel === 'Finalizar llamada con Anny');
  await act(async () => button.props.onPress());
  expect(controls.running).toBe(false);
  expect(endVoiceConversation).toHaveBeenCalledWith('temporary-ticket');
});
it('announces connecting once and waits for the cue before handing off to WebRTC', async () => {
  expect(playConversationConnecting).toHaveBeenCalledTimes(1);
  await act(async () => controls.stop());
  let finish!: () => void;
  (playConversationConnecting as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { controls.start(); await flush(); });
  expect(tree.root.findAll(node => String(node.type) === 'VoiceWebView')).toHaveLength(0);
  finish(); await act(flush);
  expect(tree.root.findAll(node => String(node.type) === 'VoiceWebView')).toHaveLength(1);
});
it('the hang-up button also cancels a pending server connection', async () => {
  await act(async () => controls.stop());
  let finish!: (session: unknown) => void;
  (createVoiceConversation as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { controls.start(); await flush(); });
  const button = tree.root.find(node => node.props.accessibilityLabel === 'Finalizar llamada con Anny');
  await act(async () => button.props.onPress());
  await act(async () => { finish({ ticket: 'late-ticket', url: 'https://voice.test/' }); await flush(); });
  expect(controls.running).toBe(false);
  expect(endVoiceConversation).toHaveBeenCalledWith('late-ticket');
  expect(tree.root.findAll(node => String(node.type) === 'VoiceWebView')).toHaveLength(0);
});

it('forwards the detected user speech turn to the destination-choice gate', async () => {
  await event({ type: 'user_turn_started' });
  const instance = (ConversationAppService as jest.Mock).mock.results.at(-1)?.value;
  expect(instance.beginUserTurn).toHaveBeenCalledTimes(1);
});

it('ends AI audio and releases its session as soon as a tutor call starts, before navigation', async () => {
  await event({ type: 'ready' });
  await event({ type: 'status', text: 'Hablando', connected: true });
  mockPath = '/home'; mockAssistance.phase = 'calling';
  await act(async () => { tree.update(element()); });
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('AnnyVoice?.stop('));
  expect(endVoiceConversation).toHaveBeenCalledWith('temporary-ticket');
  expect(controls.running).toBe(false);
  expect(tree.root.findAll(node => String(node.type) === 'VoiceWebView')).toHaveLength(0);
  await act(async () => controls.start());
  expect(createVoiceConversation).toHaveBeenCalledTimes(1);
  await act(async () => mockListeners.forEach(listener => listener('active')));
  expect(controls.running).toBe(false);
});
it('returns actual places for the legacy nearby command rather than only opening a screen', async () => {
  const instance = (ConversationAppService as jest.Mock).mock.results.at(-1)?.value;
  instance.run.mockResolvedValueOnce({ ok: true, places: [{ name: 'Farmacia Centro', distanceMeters: 80 }] });
  await event({ type: 'tool', id: 'nearby', plan: { type: 'native', name: 'execute_anny_command', arguments: { text: 'lugares cercanos', command: 'cercano', action: 'nearby' } } });
  expect(instance.run).toHaveBeenCalledWith('search_places', {}, expect.anything());
  expect(mockInject.mock.calls.at(-1)[0]).toContain('Farmacia Centro');
});

it('answers where I am using the exploration fix with its real accuracy instead of a route-only precision gate', async () => {
  (getExplorationLocation as jest.Mock).mockResolvedValueOnce({ latitude: -33.123, longitude: -64.349, accuracy: 85, timestamp: Date.now() });
  (reverseGeocodeLocation as jest.Mock).mockResolvedValueOnce('San Martín 120, Río Cuarto');
  await event({ type: 'tool', id: 'where', plan: { type: 'native', name: 'get_current_location', arguments: {} } });
  const script = mockInject.mock.calls.at(-1)[0];
  expect(script).toContain('"ok":true'); expect(script).toContain('San Martín 120');
  expect(script).toContain('"accuracyMeters":85'); expect(script).toContain('"approximate":true');
});
