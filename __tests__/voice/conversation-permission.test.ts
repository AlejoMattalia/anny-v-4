import { PermissionsAndroid } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { requestConversationMicrophone } from '../../src/lib/voice';

jest.mock('react-native', () => ({ Platform: { OS: 'android' }, PermissionsAndroid: {
  PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' }, RESULTS: { GRANTED: 'granted' }, check: jest.fn(), request: jest.fn(),
} }));
jest.mock('expo-speech', () => ({}));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: { getPermissionsAsync: jest.fn(() => { throw new Error('Speech recognizer unavailable'); }) } }));
jest.mock('../../src/lib/settings-storage', () => ({}));
jest.mock('../../src/services/StreamingClock', () => ({}));
beforeEach(() => { jest.clearAllMocks(); });
it('starts with an already granted Android microphone without invoking speech recognition or another permission dialog', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(true);
  await expect(requestConversationMicrophone()).resolves.toBeUndefined();
  expect(PermissionsAndroid.check).toHaveBeenCalledWith('android.permission.RECORD_AUDIO');
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  expect(ExpoSpeechRecognitionModule.getPermissionsAsync).not.toHaveBeenCalled();
});
it('requests only RECORD_AUDIO when needed', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('granted');
  await expect(requestConversationMicrophone()).resolves.toBeUndefined();
  expect(PermissionsAndroid.request).toHaveBeenCalledWith('android.permission.RECORD_AUDIO');
});
it('reports a denied microphone instead of proceeding into a stalled call', async () => {
  (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
  (PermissionsAndroid.request as jest.Mock).mockResolvedValue('denied');
  await expect(requestConversationMicrophone()).rejects.toThrow('acceso al micrófono');
});
