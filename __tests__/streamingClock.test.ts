import {NativeModules} from 'react-native';
import {streamingInterval, streamingTimeout} from '../src/services/StreamingClock';

jest.mock('react-native', () => ({Platform: {OS: 'android'}, NativeModules: {LocalLensFrames: {delay: jest.fn()}}}));
const deadlines: (() => void)[] = [];
beforeEach(() => {
  deadlines.length = 0;
  (NativeModules.LocalLensFrames.delay as jest.Mock).mockImplementation(() => new Promise<void>(resolve => deadlines.push(resolve)));
});
async function tick() { deadlines.shift()!(); await Promise.resolve(); }

test('native deadlines drive background work without display timers and never replay missed intervals', async () => {
  const callback = jest.fn();
  const cancel = streamingInterval(callback, 1500, 900);
  expect(callback).not.toHaveBeenCalled();
  await tick();
  expect(callback).toHaveBeenCalledTimes(1);
  await tick();
  expect(callback).toHaveBeenCalledTimes(2);
  cancel();
  await tick();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(deadlines).toHaveLength(0);
});

test('pausing before the first native deadline prevents a late capture', async () => {
  const callback = jest.fn();
  streamingInterval(callback, 1500, 900)();
  await tick();
  expect(callback).not.toHaveBeenCalled();
});

test('a completed speech or request cancels its native timeout callback', async () => {
  const callback = jest.fn();
  streamingTimeout(callback, 10000)();
  await tick();
  expect(callback).not.toHaveBeenCalled();
  streamingTimeout(callback, 10000);
  await tick();
  expect(callback).toHaveBeenCalledTimes(1);
});
