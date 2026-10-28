import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import AssistanceCallScreen from '../../src/app/assistance-call';
import AssistanceMedia from '../../src/components/assistance-media';
import WifiLensCamera from '../../src/components/WifiLensCamera';
import { useAssistance } from '../../src/context/assistance-context';
import { useWifiLens } from '../../src/context/wifi-lens-context';
import { sendAssistanceFrame, type AssistanceRole } from '../../src/lib/assistance-api';
import { createCameraViewSession, getRemoteCameras } from '../../src/lib/remote-cameras';
import RemoteCameraStream from '../../src/components/remote-camera-stream';
import type { AssistanceRemoteCamera } from '../../src/lib/assistance-remote-camera';

const mockAppListeners = new Set<(state: string) => void>();
const mockSendSource = jest.fn();
const mockSendRemoteCamera = jest.fn();
const mockCapture = jest.fn();
const mockEndCall = jest.fn();
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
  AppState: {
    currentState: 'active',
    addEventListener: (_: string, fn: (state: string) => void) => {
      mockAppListeners.add(fn);
      return { remove: () => mockAppListeners.delete(fn) };
    },
  },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../../src/context/assistance-context', () => ({ useAssistance: jest.fn() }));
jest.mock('../../src/context/wifi-lens-context', () => ({ useWifiLens: jest.fn() }));
jest.mock('../../src/lib/voice', () => ({ speak: jest.fn() }));
jest.mock('../../src/lib/remote-cameras', () => ({
  streamingApiUrl: 'https://video.example/api/streaming',
  getRemoteCameras: jest.fn(), createCameraViewSession: jest.fn(),
}));
jest.mock('../../src/lib/assistance-api', () => ({
  assistanceVideoUrl: 'https://video.example', sendAssistanceFrame: jest.fn(),
}));
jest.mock('../../src/components/assistance-media', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: function Media({ ref }: { ref: React.Ref<unknown> }) {
    React.useImperativeHandle(ref, () => ({ sendSource: mockSendSource, sendRemoteCamera: mockSendRemoteCamera }), []);
    return null;
  } };
});
jest.mock('../../src/components/WifiLensCamera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: function Lens({ ref, onReady }: { ref: React.Ref<unknown>; onReady: (ready: boolean) => void }) {
    React.useImperativeHandle(ref, () => ({ capture: mockCapture }), []);
    React.useEffect(() => { onReady(true); return () => onReady(false); }, [onReady]);
    return null;
  } };
});

const reservation = { idPdv: 'pdv', idTutor: 'tutor', streamPort: 50000, streamCode: 'a/b' };
let tree: ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  AppState.currentState = 'active';
  mockCapture.mockResolvedValue('fresh-jpeg');
  (sendAssistanceFrame as jest.Mock).mockReset().mockResolvedValue({ status: true });
  (getRemoteCameras as jest.Mock).mockReset().mockResolvedValue([]);
  (createCameraViewSession as jest.Mock).mockReset();
});
afterEach(async () => {
  await act(async () => tree.unmount());
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  expect(mockAppListeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
async function open(role: AssistanceRole, lenses: boolean) {
  (useAssistance as jest.Mock).mockReturnValue({ call: reservation, role, endCall: mockEndCall });
  (useWifiLens as jest.Mock).mockReturnValue({ wifiLensConnection: { phase: lenses ? 'connected' : 'idle' } });
  await act(async () => { tree = create(React.createElement(AssistanceCallScreen)); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onConnected(); });
}
async function toggleSource() {
  await act(async () => { tree.root.findAllByType(Pressable)[0].props.onPress(); });
}
async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

it('uses only the phone video path when PDV has no connected lenses', async () => {
  await open('PDV', false);
  await advance(1000);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  expect(tree.root.findAllByType(WifiLensCamera)).toHaveLength(0);
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(mockCapture).not.toHaveBeenCalled();
  expect(sendAssistanceFrame).not.toHaveBeenCalled();
  await toggleSource();
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
});

it('shares lenses, stops uploads on phone mode and resumes with current frames', async () => {
  await open('PDV', true);
  await advance(250);
  expect(sendAssistanceFrame).toHaveBeenCalledWith(reservation, 'fresh-jpeg', expect.any(AbortSignal));
  await toggleSource();
  const uploads = (sendAssistanceFrame as jest.Mock).mock.calls.length;
  await advance(1000);
  expect(sendAssistanceFrame).toHaveBeenCalledTimes(uploads);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  await toggleSource();
  await advance(250);
  expect((sendAssistanceFrame as jest.Mock).mock.calls.length).toBeGreaterThan(uploads);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(true);
  expect(mockEndCall).not.toHaveBeenCalled();
});

it('falls back to the phone and informs the tutor when lens uploads fail', async () => {
  (sendAssistanceFrame as jest.Mock).mockRejectedValue(new Error('offline'));
  await open('PDV', true);
  await advance(1000);
  expect(sendAssistanceFrame).toHaveBeenCalledTimes(3);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  expect(mockSendSource).toHaveBeenLastCalledWith(false);
  expect(mockEndCall).not.toHaveBeenCalled();
});

it('stops lens uploads in background and resumes after returning to the call', async () => {
  await open('PDV', true);
  await advance(250);
  await act(async () => { mockAppListeners.forEach(fn => fn('background')); });
  const uploads = (sendAssistanceFrame as jest.Mock).mock.calls.length;
  await advance(1000);
  expect(sendAssistanceFrame).toHaveBeenCalledTimes(uploads);
  await act(async () => { mockAppListeners.forEach(fn => fn('active')); });
  await advance(250);
  expect((sendAssistanceFrame as jest.Mock).mock.calls.length).toBeGreaterThan(uploads);
});

it('switches the tutor between phone video and the reserved lens feed without uploading', async () => {
  await open('TUTOR', false);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onSource(true); });
  expect(tree.root.findByType(WebView).props.source.uri).toBe('https://video.example/video_feed/50000/a%2Fb');
  expect(mockSendSource).not.toHaveBeenCalled();
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onSource(false); });
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  await advance(1000);
  expect(mockCapture).not.toHaveBeenCalled();
  expect(sendAssistanceFrame).not.toHaveBeenCalled();
  expect(mockEndCall).not.toHaveBeenCalled();
});

it('stops PDV HTTP captures once the same preview is sent through the call video track', async () => {
  await open('PDV', true);
  await advance(100);
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onLensVideoTransport(true); });
  const uploads = (sendAssistanceFrame as jest.Mock).mock.calls.length;
  await advance(1000);
  expect(sendAssistanceFrame).toHaveBeenCalledTimes(uploads);
  expect(tree.root.findAllByType(WifiLensCamera)).toHaveLength(1); // Keep the actual lens preview alive.
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onLensVideoTransport(false); });
  await advance(100);
  expect((sendAssistanceFrame as jest.Mock).mock.calls.length).toBeGreaterThan(uploads);
});

it('shows the call video instead of a second WebView for direct lens video on the tutor', async () => {
  await open('TUTOR', false);
  await act(async () => {
    tree.root.findByType(AssistanceMedia).props.onSource(true);
    tree.root.findByType(AssistanceMedia).props.onLensVideoTransport(true);
  });
  expect(tree.root.findAllByType(AssistanceMedia)).toHaveLength(1);
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(tree.root.findAllByType(WifiLensCamera)).toHaveLength(0);
});

const remote = { id: 'camera_aabbccddeeff', enabled: true, online: true };
const streamUrl = `https://video.example/webrtc/${remote.id}/?token=read-only`;

it('opens the PDV server camera without local lenses, uploading frames or recoding video', async () => {
  (getRemoteCameras as jest.Mock).mockResolvedValue([remote]);
  (createCameraViewSession as jest.Mock).mockResolvedValue({ streamUrl, expiresIn: 300 });
  await open('PDV', false);
  expect(createCameraViewSession).toHaveBeenCalledWith(remote.id);
  expect(tree.root.findByType(RemoteCameraStream).props.streamUrl).toBe(streamUrl);
  expect(tree.root.findByType(WebView).props.source).toEqual({ uri: streamUrl });
  expect(tree.root.findByType(AssistanceMedia).props.serverVideo).toBe(true);
  expect(mockSendRemoteCamera).toHaveBeenCalledWith(expect.objectContaining({ cameraId: remote.id, streamUrl }));
  await advance(1000);
  expect(tree.root.findAllByType(WifiLensCamera)).toHaveLength(0);
  expect(mockCapture).not.toHaveBeenCalled();
  expect(sendAssistanceFrame).not.toHaveBeenCalled();
  await toggleSource();
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(tree.root.findByType(AssistanceMedia).props.serverVideo).toBe(false);
  expect(mockSendSource).toHaveBeenLastCalledWith(false);
  await toggleSource();
  expect(tree.root.findByType(RemoteCameraStream).props.streamUrl).toBe(streamUrl);
});

it('shows the exact shared server URL and format on the tutor without querying its own cameras', async () => {
  await open('TUTOR', false);
  const camera: AssistanceRemoteCamera = { cameraId: remote.id, streamUrl, expiresAt: Date.now() + 300000 };
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onRemoteCamera(camera); });
  const player = tree.root.findByType(WebView);
  expect(player.props.source).toEqual({ uri: streamUrl });
  expect(player.props.mediaPlaybackRequiresUserAction).toBe(false);
  expect(player.props.injectedJavaScript).toContain('object-fit:contain');
  expect(tree.root.findByType(AssistanceMedia).props.serverVideo).toBe(true);
  expect(getRemoteCameras).not.toHaveBeenCalled();
  expect(createCameraViewSession).not.toHaveBeenCalled();
  expect(mockCapture).not.toHaveBeenCalled();
  expect(sendAssistanceFrame).not.toHaveBeenCalled();
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onSource(false); });
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
});

it('renews server access and shares it without reloading healthy players', async () => {
  (getRemoteCameras as jest.Mock).mockResolvedValue([remote]);
  const renewed = streamUrl.replace('read-only', 'renewed');
  (createCameraViewSession as jest.Mock).mockResolvedValueOnce({ streamUrl, expiresIn: 300 })
    .mockResolvedValue({ streamUrl: renewed, expiresIn: 300 });
  await open('PDV', false);
  const originalSource = tree.root.findByType(WebView).props.source;
  await advance(240000);
  expect(createCameraViewSession).toHaveBeenCalledTimes(2);
  expect(mockSendRemoteCamera).toHaveBeenLastCalledWith(expect.objectContaining({ streamUrl: renewed }));
  expect(tree.root.findByType(RemoteCameraStream).props.streamUrl).toBe(renewed);
  expect(tree.root.findByType(WebView).props.source).toBe(originalSource);
  expect(mockEndCall).not.toHaveBeenCalled();
});

it('ignores a late server session after switching to the phone', async () => {
  (getRemoteCameras as jest.Mock).mockResolvedValue([remote]);
  let finish!: (value: { streamUrl: string; expiresIn: number }) => void;
  (createCameraViewSession as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open('PDV', false);
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onSource(false); });
  await act(async () => { finish({ streamUrl, expiresIn: 300 }); });
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  expect(tree.root.findByType(AssistanceMedia).props.glasses).toBe(false);
  expect(mockSendRemoteCamera).not.toHaveBeenCalled();
});

it('renews an expired server session before reopening the PDV player after backgrounding', async () => {
  (getRemoteCameras as jest.Mock).mockResolvedValue([remote]);
  const renewed = streamUrl.replace('read-only', 'renewed');
  (createCameraViewSession as jest.Mock).mockResolvedValueOnce({ streamUrl, expiresIn: 300 })
    .mockResolvedValue({ streamUrl: renewed, expiresIn: 300 });
  await open('PDV', false);
  await act(async () => { mockAppListeners.forEach(fn => fn('background')); });
  await advance(360000);
  expect(createCameraViewSession).toHaveBeenCalledTimes(1);
  await act(async () => { mockAppListeners.forEach(fn => fn('active')); });
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  await advance(0);
  expect(tree.root.findByType(WebView).props.source).toEqual({ uri: renewed });
  expect(mockSendRemoteCamera).toHaveBeenLastCalledWith(expect.objectContaining({ streamUrl: renewed }));
});

it('asks the PDV for new access when the tutor resumes with an expired session', async () => {
  await open('TUTOR', false);
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onRemoteCamera({ cameraId: remote.id, streamUrl, expiresAt: Date.now() + 300000 }); });
  await act(async () => { mockAppListeners.forEach(fn => fn('background')); });
  await advance(360000);
  await act(async () => { mockAppListeners.forEach(fn => fn('active')); });
  expect(mockSendSource).toHaveBeenLastCalledWith(true);
  expect(tree.root.findAllByType(WebView)).toHaveLength(0);
  const renewed = streamUrl.replace('read-only', 'renewed');
  await act(async () => { tree.root.findByType(AssistanceMedia).props.onRemoteCamera({ cameraId: remote.id, streamUrl: renewed, expiresAt: Date.now() + 300000 }); });
  expect(tree.root.findByType(WebView).props.source).toEqual({ uri: renewed });
  expect(createCameraViewSession).not.toHaveBeenCalled();
});
