import {canRunStreaming} from '../src/services/StreamingActivity';

test('Android glasses keep analyzing with the screen off only after the service starts', () => {
  expect(canRunStreaming(true, false, 'glasses', true, true)).toBe(true);
  expect(canRunStreaming(true, false, 'glasses', true, false)).toBe(false);
});

test('leaving the streaming screen always stops analysis', () => {
  for (const foreground of [false, true]) {
    expect(canRunStreaming(false, foreground, 'glasses', true, true)).toBe(false);
  }
});

test('phone camera and iOS retain foreground-only behavior', () => {
  expect(canRunStreaming(true, false, 'phone', true, true)).toBe(false);
  expect(canRunStreaming(true, false, 'glasses', false, true)).toBe(false);
  expect(canRunStreaming(true, true, 'phone', true, false)).toBe(true);
  expect(canRunStreaming(true, true, 'glasses', false, false)).toBe(true);
});
