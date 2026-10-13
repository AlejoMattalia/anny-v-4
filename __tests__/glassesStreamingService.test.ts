import {AppState, PermissionsAndroid, Platform} from 'react-native';
import BackgroundService from 'react-native-background-actions';
import {startGlassesStreamingService, stopGlassesStreamingService} from '../src/services/GlassesStreamingService';

let mockRunning = false;
jest.mock('react-native', () => ({
  Platform: {OS: 'android', Version: 35},
  AppState: {currentState: 'active'},
  PermissionsAndroid: {
    PERMISSIONS: {POST_NOTIFICATIONS: 'notifications'},
    check: jest.fn(async () => true), request: jest.fn(async () => 'granted'),
  },
}));
jest.mock('react-native-background-actions', () => ({
  __esModule: true,
  default: {
    isRunning: () => mockRunning,
    start: jest.fn(async () => { mockRunning = true; }),
    stop: jest.fn(async () => { mockRunning = false; }),
  },
}));

beforeEach(() => { jest.clearAllMocks(); mockRunning = false; AppState.currentState = 'active'; });

test('the last camera owner releases the service, not a previous screen cleanup', async () => {
  const a = Symbol('a'), b = Symbol('b');
  await startGlassesStreamingService(a);
  await startGlassesStreamingService(b);
  expect(BackgroundService.start).toHaveBeenCalledTimes(1);
  expect(BackgroundService.start).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
    linkingURI: 'annyv4://realtime-streaming', foregroundServiceType: ['connectedDevice'],
  }));
  await stopGlassesStreamingService(a);
  expect(BackgroundService.stop).not.toHaveBeenCalled();
  await stopGlassesStreamingService(b);
  expect(BackgroundService.stop).toHaveBeenCalledTimes(1);
});

test('a camera closed before queued startup does not create an orphan service', async () => {
  const owner = Symbol('closed');
  const start = startGlassesStreamingService(owner);
  const stop = stopGlassesStreamingService(owner);
  await Promise.all([start, stop]);
  expect(BackgroundService.start).not.toHaveBeenCalled();
});

test('a new background start is rejected, but an already running service can retain a lease', async () => {
  const owner = Symbol('late');
  AppState.currentState = 'background';
  await expect(startGlassesStreamingService(owner)).rejects.toThrow('Abrí Anny');
  expect(BackgroundService.start).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await startGlassesStreamingService(owner);
  const second = Symbol('handoff');
  AppState.currentState = 'background';
  await startGlassesStreamingService(second);
  await stopGlassesStreamingService(owner);
  expect(mockRunning).toBe(true);
  await stopGlassesStreamingService(second);
});

test('locking during the notification prompt cannot start a restricted service', async () => {
  const owner = Symbol('permission');
  (PermissionsAndroid.check as jest.Mock).mockResolvedValueOnce(false);
  (PermissionsAndroid.request as jest.Mock).mockImplementationOnce(async () => {
    AppState.currentState = 'background';
    return 'granted';
  });
  await expect(startGlassesStreamingService(owner)).rejects.toThrow('Volvé a Anny');
  expect(BackgroundService.start).not.toHaveBeenCalled();
  await stopGlassesStreamingService(owner);
  expect(Platform.OS).toBe('android');
});
