import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AssistanceMedia from '../../src/components/assistance-media.native';
import { Voximplant } from 'react-native-voximplant';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { remoteCameraFeed, remoteCameraMessage } from '../../src/lib/assistance-remote-camera';
import type { AssistanceMediaHandle } from '../../src/components/assistance-media.types';

jest.mock('react-native', () => ({
  NativeModules: {}, Platform: { OS: 'android', Version: 36 }, StyleSheet: { absoluteFill: {} },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_CONNECT: 'bluetooth-connect' },
    check: jest.fn().mockResolvedValue(true), request: jest.fn().mockResolvedValue('granted'),
  },
}));
jest.mock('expo-camera', () => ({ Camera: { requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }), requestMicrophonePermissionsAsync: jest.fn().mockResolvedValue({ granted: true }) } }));
jest.mock('react-native-voximplant', () => {
  const emitter = () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    return {
      on: (name: string, fn: (event: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
      off: (name: string, fn: (event: unknown) => void) => listeners.get(name)?.delete(fn),
      emit: (name: string, data = {}) => listeners.get(name)?.forEach(fn => fn(data)),
    };
  };
  const endpoint = emitter();
  const audio = {
    ...emitter(), getAudioDevices: jest.fn().mockResolvedValue(['speaker', 'earpiece']),
    getActiveDevice: jest.fn().mockResolvedValue('earpiece'), selectAudioDevice: jest.fn(),
  };
  const call = { ...emitter(), callId: 'call-1', getEndpoints: () => [endpoint], answer: jest.fn(), hangup: jest.fn(), decline: jest.fn(), sendAudio: jest.fn(), sendVideo: jest.fn().mockResolvedValue(undefined), sendMessage: jest.fn() };
  const client = { ...emitter(), connect: jest.fn((options?: { node?: string }) => options?.node
    ? Promise.resolve({})
    : Promise.reject({ name: 'ConnectionFailed', message: 'ConnectOptions and ConnectionNode are required' })),
  login: jest.fn().mockResolvedValue({}), disconnect: jest.fn().mockResolvedValue({}), getClientState: jest.fn().mockResolvedValue('LOGGED_IN'), call: jest.fn().mockResolvedValue(call) };
  return { Voximplant: {
    getInstance: () => client, mockCall: call, mockEndpoint: endpoint, VideoView: () => null, RenderScaleType: { SCALE_FIT: 'fit' },
    ClientState: { DISCONNECTED: 'DISCONNECTED' },
    ConnectionNode: { NODE_1: 'node1' },
    ClientEvents: { IncomingCall: 'incoming', ConnectionFailed: 'connection-failed', ConnectionClosed: 'closed' },
    CallEvents: { Connected: 'connected', Disconnected: 'disconnected', Failed: 'failed', ICETimeout: 'timeout', EndpointAdded: 'endpoint', LocalVideoStreamAdded: 'local-video', MessageReceived: 'message' },
    EndpointEvents: { RemoteVideoStreamAdded: 'remote-video', RemoteVideoStreamRemoved: 'remove-video' },
    Hardware: {
      CameraManager: { getInstance: () => ({ switchCamera: jest.fn() }) },
      AudioDeviceManager: { getInstance: () => audio }, AudioDeviceEvents: { DeviceListChanged: 'devices-changed' },
      AudioDevice: { BLUETOOTH: 'bluetooth', WIRED_HEADSET: 'wired', SPEAKER: 'speaker', EARPIECE: 'earpiece' },
    },
  } };
});
const sdk = Voximplant as typeof Voximplant & { mockEndpoint: { emit(name: string, event?: unknown): void }; mockCall: { emit(name: string, event?: unknown): void; answer: jest.Mock; hangup: jest.Mock; decline: jest.Mock; sendAudio: jest.Mock; sendVideo: jest.Mock; sendMessage: jest.Mock } };
const client = sdk.getInstance() as ReturnType<typeof sdk.getInstance> & { emit(name: string, event?: unknown): void };
const audio = sdk.Hardware.AudioDeviceManager.getInstance() as ReturnType<typeof sdk.Hardware.AudioDeviceManager.getInstance> & {
  emit(name: string, event?: unknown): void;
  getAudioDevices: jest.Mock; getActiveDevice: jest.Mock; selectAudioDevice: jest.Mock;
};
let tree: ReactTestRenderer;
const callbacks = { onConnected: jest.fn(), onEnded: jest.fn(), onSource: jest.fn(), onError: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  Platform.OS = 'android';
  delete NativeModules.LocalLensCallVideo;
  audio.getAudioDevices.mockReset().mockResolvedValue(['speaker', 'earpiece']);
  audio.getActiveDevice.mockReset().mockResolvedValue('earpiece');
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(true);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('granted');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_USER = 'pdv@example';
  process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_PASSWORD = 'test';
  process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_USER = 'tutor@example';
  process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_PASSWORD = 'test';
});
afterEach(async () => { await act(async () => tree.unmount()); jest.useRealTimers(); });
it.each([true, false])('attaches the iOS custom source before answering (glasses=%s)', async glasses => {
  Platform.OS = 'ios';
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses, ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); });
  expect(bridge.setSource).toHaveBeenCalledWith('call-1', glasses);
  expect(bridge.setSource.mock.invocationCallOrder[0]).toBeLessThan(sdk.mockCall.answer.mock.invocationCallOrder[0]);
  await act(async () => { sdk.mockCall.emit('connected'); sdk.mockCall.emit('message', { text: 'LENS_VIDEO_WEBRTC_V1' }); });
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});
it('never answers after unmount and releases a source that was still preparing on iOS', async () => {
  Platform.OS = 'ios'; let finish!: () => void;
  const bridge = { setSource: jest.fn(() => new Promise<void>(resolve => { finish = resolve; })), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses: true, ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); });
  await act(async () => { tree.unmount(); });
  expect(sdk.mockCall.answer).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(sdk.mockCall.answer).not.toHaveBeenCalled();
  expect(bridge.stop).toHaveBeenCalledWith('call-1');
});
it('prepares iOS video before answering even when a server camera is initially selected', async () => {
  Platform.OS = 'ios';
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  const props = { role: 'PDV' as const, ...callbacks };
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { ...props, serverVideo: true, glasses: true })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); });
  expect(bridge.setSource.mock.invocationCallOrder[0]).toBeLessThan(sdk.mockCall.answer.mock.invocationCallOrder[0]);
  await act(async () => { sdk.mockCall.emit('connected'); });
  expect(sdk.mockCall.sendVideo).not.toHaveBeenCalled();
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, serverVideo: false, glasses: false })); });
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', false);
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
});
it.each(['PDV', 'TUTOR'] as const)('connects %s to the existing account node before authenticating', async role => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role, ...callbacks })); });
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(client.connect).toHaveBeenCalledWith({ node: 'node1' });
  expect(client.login).toHaveBeenCalledWith(role === 'PDV' ? 'pdv@example' : 'tutor@example', 'test');
  expect((client.connect as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((client.login as jest.Mock).mock.invocationCallOrder[0]);
});
it('answers on PDV with SDK methods that return void, handles source changes and releases the call', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); sdk.mockCall.emit('message', { text: 'SHOW_GLASSES' }); });
  expect(sdk.mockCall.answer).toHaveBeenCalled(); expect(callbacks.onConnected).toHaveBeenCalledTimes(1);
  expect(callbacks.onSource).toHaveBeenCalledWith(true); expect(callbacks.onError).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
  expect(sdk.mockCall.hangup).toHaveBeenCalled(); expect(client.disconnect).toHaveBeenCalled();
});
it('retries an unavailable PDV and stops retrying after it connects', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'TUTOR', ...callbacks })); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(client.call).toHaveBeenCalledTimes(1);
  await act(async () => { sdk.mockCall.emit('failed', { code: 480 }); jest.advanceTimersByTime(2000); });
  expect(client.call).toHaveBeenCalledTimes(2);
  await act(async () => { sdk.mockCall.emit('connected'); jest.advanceTimersByTime(60000); });
  expect(callbacks.onError).not.toHaveBeenCalled();
});
it('rejects incoming calls after the connection deadline instead of silently answering', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  await act(async () => { jest.advanceTimersByTime(30000); client.emit('incoming', { call: sdk.mockCall }); });
  expect(callbacks.onError).toHaveBeenCalledTimes(1); expect(sdk.mockCall.decline).toHaveBeenCalled();
  expect(sdk.mockCall.answer).not.toHaveBeenCalled();
});

it('receives PDV video without uploading the unseen tutor camera', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'TUTOR', ...callbacks })); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(client.call).toHaveBeenCalledWith('pdv', { video: { sendVideo: false, receiveVideo: true } });
  await act(async () => {
    sdk.mockCall.emit('connected');
    sdk.mockCall.emit('local-video', { videoStream: { id: 'tutor-camera' } });
    sdk.mockEndpoint.emit('remote-video', { videoStream: { id: 'pdv-camera' } });
  });
  expect(tree.root.findByType(sdk.VideoView).props.videoStreamId).toBe('pdv-camera');
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  await act(async () => { sdk.mockEndpoint.emit('remove-video'); });
  expect(tree.root.findAllByType(sdk.VideoView)).toHaveLength(0);
  await act(async () => { sdk.mockEndpoint.emit('remote-video', { videoStream: { id: 'pdv-camera-restored' } }); });
  expect(tree.root.findByType(sdk.VideoView).props.videoStreamId).toBe('pdv-camera-restored');
});

it('starts PDV phone video and shows its local preview rather than the tutor stream', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses: false, ...callbacks })); });
  await act(async () => {
    client.emit('incoming', { call: sdk.mockCall });
    sdk.mockCall.emit('connected');
    sdk.mockCall.emit('local-video', { videoStream: { id: 'pdv-camera' } });
    sdk.mockEndpoint.emit('remote-video', { videoStream: { id: 'tutor-camera' } });
  });
  expect(sdk.mockCall.answer).toHaveBeenCalledWith({ video: { sendVideo: true, receiveVideo: false } });
  expect(tree.root.findByType(sdk.VideoView).props.videoStreamId).toBe('pdv-camera');
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('keeps audio with lenses and restores the PDV camera without reconnecting', async () => {
  const props = { role: 'PDV' as const, ...callbacks };
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { ...props, glasses: true })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(sdk.mockCall.answer).toHaveBeenCalledWith({ video: { sendVideo: false, receiveVideo: false } });
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  expect(sdk.mockCall.sendVideo).not.toHaveBeenCalled();
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: false })); });
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: true })); });
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(false);
  expect(client.connect).toHaveBeenCalledTimes(1);
});

it('serializes camera changes and applies the latest source after a pending update', async () => {
  const props = { role: 'PDV' as const, ...callbacks };
  let finish!: () => void;
  sdk.mockCall.sendVideo.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { ...props, glasses: false })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: true })); });
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: false })); });
  expect(sdk.mockCall.sendVideo).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
  expect(sdk.mockCall.sendVideo).toHaveBeenCalledTimes(2);
});

it('sends the displayed lenses through WebRTC after both Android peers negotiate support', async () => {
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  const onLensVideoTransport = jest.fn();
  const props = { role: 'PDV' as const, ...callbacks, onLensVideoTransport };
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { ...props, glasses: true })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(sdk.mockCall.sendMessage).toHaveBeenCalledWith('LENS_VIDEO_WEBRTC_V1');
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', true);
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(false);
  await act(async () => { sdk.mockCall.emit('message', { text: 'LENS_VIDEO_WEBRTC_V1' }); });
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', true);
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(true);
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: false })); });
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', false);
  expect(sdk.mockCall.sendVideo).toHaveBeenCalledTimes(1); // Switch sources without stopping the video track.
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  await act(async () => { sdk.mockCall.emit('disconnected'); tree.unmount(); });
  expect(bridge.stop).toHaveBeenCalledWith('call-1');
});

it('keeps older peers on HTTP and tells both ends to fall back if the native source fails', async () => {
  const bridge = { setSource: jest.fn().mockRejectedValue(new Error('source failed')), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  const onLensVideoTransport = jest.fn();
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses: true, ...callbacks, onLensVideoTransport })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', true);
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(false);
  await act(async () => { sdk.mockCall.emit('message', { text: 'LENS_VIDEO_WEBRTC_V1' }); });
  expect(sdk.mockCall.sendMessage).toHaveBeenCalledWith('LENS_VIDEO_HTTP');
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(false);
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('uses the tutor video track for negotiated lenses without opening a local custom source', async () => {
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  const onLensVideoTransport = jest.fn();
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'TUTOR', glasses: true, ...callbacks, onLensVideoTransport })); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  await act(async () => { sdk.mockCall.emit('connected'); sdk.mockCall.emit('message', { text: 'LENS_VIDEO_WEBRTC_V1' }); });
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(true);
  expect(bridge.setSource).not.toHaveBeenCalled();
  expect(sdk.mockCall.sendVideo).not.toHaveBeenCalled();
  await act(async () => { sdk.mockCall.emit('message', { text: 'LENS_VIDEO_HTTP' }); });
  expect(onLensVideoTransport).toHaveBeenLastCalledWith(false);
});

it('prepares the Android phone source before creating its first outgoing video track', async () => {
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses: false, ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(sdk.mockCall.answer).toHaveBeenCalledWith({ video: { sendVideo: false, receiveVideo: false } });
  expect(bridge.setSource).toHaveBeenCalledWith('call-1', false);
  expect(sdk.mockCall.sendVideo).toHaveBeenCalledWith(true);
  expect(bridge.setSource.mock.invocationCallOrder[0]).toBeLessThan(sdk.mockCall.sendVideo.mock.invocationCallOrder[0]);
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it('keeps server video out of the call encoder and leaves audio enabled when switching cameras', async () => {
  const bridge = { setSource: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) };
  NativeModules.LocalLensCallVideo = bridge;
  const props = { role: 'PDV' as const, ...callbacks };
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { ...props, glasses: true, serverVideo: true })); });
  await act(async () => {
    client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected');
    sdk.mockCall.emit('message', { text: 'LENS_VIDEO_WEBRTC_V1' });
  });
  expect(sdk.mockCall.answer).toHaveBeenCalledWith({ video: { sendVideo: false, receiveVideo: false } });
  expect(bridge.setSource).not.toHaveBeenCalled();
  expect(sdk.mockCall.sendVideo).not.toHaveBeenCalled();
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: false, serverVideo: false })); });
  expect(bridge.setSource).toHaveBeenLastCalledWith('call-1', false);
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(true);
  await act(async () => { tree.update(React.createElement(AssistanceMedia, { ...props, glasses: true, serverVideo: true })); });
  expect(sdk.mockCall.sendVideo).toHaveBeenLastCalledWith(false);
  expect(client.connect).toHaveBeenCalledTimes(1);
});

it('sends the temporary server session and receives it only on the tutor', async () => {
  const camera = remoteCameraFeed('camera_aabbccddeeff', {
    streamUrl: 'https://video.example/webrtc/camera_aabbccddeeff/?token=read-only', expiresIn: 300,
  });
  const ref = React.createRef<AssistanceMediaHandle>();
  const onRemoteCamera = jest.fn();
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ref, onRemoteCamera, ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  await act(async () => { ref.current?.sendRemoteCamera(camera); sdk.mockCall.emit('message', { text: remoteCameraMessage(camera) }); });
  expect(sdk.mockCall.sendMessage).toHaveBeenCalledWith(remoteCameraMessage(camera));
  expect(onRemoteCamera).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'TUTOR', onRemoteCamera, ...callbacks })); });
  await act(async () => { jest.advanceTimersByTime(2000); });
  await act(async () => { sdk.mockCall.emit('connected'); sdk.mockCall.emit('message', { text: remoteCameraMessage(camera) }); });
  expect(onRemoteCamera).toHaveBeenCalledWith(camera);
  await act(async () => { sdk.mockCall.emit('message', { text: remoteCameraMessage({ ...camera, expiresAt: 1 }) }); });
  expect(onRemoteCamera).toHaveBeenCalledTimes(1);
});

it.each(['PDV', 'TUTOR'] as const)('routes %s call audio to connected Bluetooth instead of forcing the phone speaker', async role => {
  audio.getAudioDevices.mockResolvedValue(['speaker', 'earpiece', 'bluetooth']);
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role, ...callbacks })); });
  await act(async () => {
    if (role === 'PDV') client.emit('incoming', { call: sdk.mockCall });
    else jest.advanceTimersByTime(2000);
  });
  await act(async () => { sdk.mockCall.emit('connected'); });
  expect(audio.selectAudioDevice).toHaveBeenCalledTimes(1);
  expect(audio.selectAudioDevice).toHaveBeenCalledWith('bluetooth');
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
});

it('follows Bluetooth connection changes during the call and removes the listener on exit', async () => {
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', glasses: true, serverVideo: true, ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(audio.selectAudioDevice).toHaveBeenLastCalledWith('speaker');
  audio.getActiveDevice.mockResolvedValue('speaker');
  await act(async () => { audio.emit('devices-changed', { newDeviceList: ['speaker', 'bluetooth'] }); });
  expect(audio.selectAudioDevice).toHaveBeenLastCalledWith('bluetooth');
  audio.getActiveDevice.mockResolvedValue('bluetooth');
  await act(async () => { audio.emit('devices-changed', { newDeviceList: ['earpiece', 'speaker'] }); });
  expect(audio.selectAudioDevice).toHaveBeenLastCalledWith('speaker');
  await act(async () => tree.unmount());
  audio.selectAudioDevice.mockClear();
  await act(async () => { audio.emit('devices-changed', { newDeviceList: ['speaker', 'bluetooth'] }); });
  expect(audio.selectAudioDevice).not.toHaveBeenCalled();
});

it('keeps an already selected Bluetooth route and uses wired audio when Bluetooth is unavailable', async () => {
  audio.getAudioDevices.mockResolvedValue(['speaker', 'bluetooth', 'wired']);
  audio.getActiveDevice.mockResolvedValue('bluetooth');
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(audio.selectAudioDevice).not.toHaveBeenCalled();
  await act(async () => { audio.emit('devices-changed', { newDeviceList: ['speaker', 'wired'] }); });
  expect(audio.selectAudioDevice).toHaveBeenLastCalledWith('wired');
});

it('does not let an old device query override a newly connected lens', async () => {
  let finish!: (devices: string[]) => void;
  audio.getAudioDevices.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  await act(async () => { audio.emit('devices-changed', { newDeviceList: ['speaker', 'bluetooth'] }); });
  expect(audio.selectAudioDevice).toHaveBeenLastCalledWith('bluetooth');
  await act(async () => { finish(['speaker']); });
  expect(audio.selectAudioDevice).toHaveBeenCalledTimes(1);
});

it('ignores device queries that complete after the call screen closes', async () => {
  let finish!: (device: string) => void;
  audio.getAudioDevices.mockResolvedValue(['speaker', 'bluetooth']);
  audio.getActiveDevice.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  await act(async () => { tree.unmount(); });
  await act(async () => { finish('speaker'); });
  expect(audio.selectAudioDevice).not.toHaveBeenCalled();
});

it('requests Android Bluetooth audio permission before connecting and allows the call if denied', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');
  await act(async () => { tree = create(React.createElement(AssistanceMedia, { role: 'PDV', ...callbacks })); });
  expect(PermissionsAndroid.request).toHaveBeenCalledWith('bluetooth-connect');
  expect((PermissionsAndroid.request as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((client.connect as jest.Mock).mock.invocationCallOrder[0]);
  await act(async () => { client.emit('incoming', { call: sdk.mockCall }); sdk.mockCall.emit('connected'); });
  expect(sdk.mockCall.sendAudio).toHaveBeenCalledWith(true);
  expect(callbacks.onError).not.toHaveBeenCalled();
});
