import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AssistanceMedia from '../../src/components/assistance-media.native';
import { Voximplant } from 'react-native-voximplant';

jest.mock('react-native', () => ({ StyleSheet: { absoluteFill: {} } }));
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
  const call = { ...emitter(), getEndpoints: () => [], answer: jest.fn(), hangup: jest.fn(), decline: jest.fn(), sendAudio: jest.fn(), sendMessage: jest.fn() };
  const client = { ...emitter(), connect: jest.fn((options?: { node?: string }) => options?.node
    ? Promise.resolve({})
    : Promise.reject({ name: 'ConnectionFailed', message: 'ConnectOptions and ConnectionNode are required' })),
  login: jest.fn().mockResolvedValue({}), disconnect: jest.fn().mockResolvedValue({}), getClientState: jest.fn().mockResolvedValue('LOGGED_IN'), call: jest.fn().mockResolvedValue(call) };
  return { Voximplant: {
    getInstance: () => client, mockCall: call, VideoView: () => null, RenderScaleType: { SCALE_FIT: 'fit' },
    ClientState: { DISCONNECTED: 'DISCONNECTED' },
    ConnectionNode: { NODE_1: 'node1' },
    ClientEvents: { IncomingCall: 'incoming', ConnectionFailed: 'connection-failed', ConnectionClosed: 'closed' },
    CallEvents: { Connected: 'connected', Disconnected: 'disconnected', Failed: 'failed', ICETimeout: 'timeout', EndpointAdded: 'endpoint', LocalVideoStreamAdded: 'local-video', MessageReceived: 'message' },
    EndpointEvents: { RemoteVideoStreamAdded: 'remote-video', RemoteVideoStreamRemoved: 'remove-video' },
    Hardware: { CameraManager: { getInstance: () => ({ switchCamera: jest.fn() }) }, AudioDeviceManager: { getInstance: () => ({ selectAudioDevice: jest.fn() }) }, AudioDevice: { SPEAKER: 'speaker' } },
  } };
});
const sdk = Voximplant as typeof Voximplant & { mockCall: { emit(name: string, event?: unknown): void; answer: jest.Mock; hangup: jest.Mock; decline: jest.Mock } };
const client = sdk.getInstance() as ReturnType<typeof sdk.getInstance> & { emit(name: string, event?: unknown): void };
let tree: ReactTestRenderer;
const callbacks = { onConnected: jest.fn(), onEnded: jest.fn(), onSource: jest.fn(), onError: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_USER = 'pdv@example';
  process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_PASSWORD = 'test';
  process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_USER = 'tutor@example';
  process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_PASSWORD = 'test';
});
afterEach(async () => { await act(async () => tree.unmount()); jest.useRealTimers(); });
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
