import { createAudioPlayer } from 'expo-audio';
import { playConversationConnecting } from '../../src/services/ConversationConnectionCue';
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));
jest.mock('../../assets/audio/connecting.wav', () => 1);
let status: (state: unknown) => void;
const player = { play: jest.fn(), remove: jest.fn(), addListener: jest.fn((_name, callback) => { status = callback; return { remove: jest.fn() }; }) };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); (createAudioPlayer as jest.Mock).mockReturnValue(player); });
afterEach(() => jest.useRealTimers());
it('plays the bundled recording and releases it before startup continues', async () => {
  const done = jest.fn(); const cue = playConversationConnecting(new AbortController().signal).then(done);
  expect(player.play).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
  status({ didJustFinish: true }); await cue;
  expect(player.remove).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('hanging up cancels the connection recording immediately', async () => {
  const controller = new AbortController(); const cue = playConversationConnecting(controller.signal);
  controller.abort(); await cue; expect(player.remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('an audio failure or stuck player cannot leave the connection waiting forever', async () => {
  const cue = playConversationConnecting(new AbortController().signal);
  await jest.advanceTimersByTimeAsync(5000); await cue;
  expect(player.remove).toHaveBeenCalledTimes(1);
});
