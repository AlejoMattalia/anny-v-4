import {lensRequest} from '../src/services/LocalWifiLens';
import {watchWifiLensButtons} from '../src/services/WifiLensButtons';

jest.mock('../src/services/LocalWifiLens', () => ({lensRequest: jest.fn()}));
const request = lensRequest as jest.Mock;
const pair = {address: 'http://192.168.1.25', password: 'test', ap: 'Lentes-123ABC'};
const snapshot = (presses: number, age: number | null = 50, boot = 1) => ({
  voice: {ready: true, boot_id: boot, presses, last_press_age_ms: age, pressed: false,
    event_mode: 'validated_click', fault: 'none'},
});
let stop: (() => void) | undefined;
let warn: jest.SpyInstance;
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  request.mockReset();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {stop?.(); stop = undefined; jest.useRealTimers(); warn.mockRestore();});

it('ignores old clicks on connection and detects a short press already released between polls', async () => {
  request.mockResolvedValueOnce(snapshot(4)).mockResolvedValue(snapshot(5));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await flush();
  expect(pressed).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith(pair.address, pair.password, '/api/buttons', undefined, 1800, expect.anything());
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(900);
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('discards a burst without toggling the microphone, then accepts a single new click', async () => {
  request.mockResolvedValueOnce(snapshot(0, null)).mockResolvedValueOnce(snapshot(2))
    .mockResolvedValue(snapshot(3));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('rebases after a firmware reboot and then accepts new presses', async () => {
  request.mockResolvedValueOnce(snapshot(10)).mockResolvedValueOnce(snapshot(1, 0, 2))
    .mockResolvedValue(snapshot(2, 0, 2));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('consumes stale presses without activating the microphone later', async () => {
  request.mockResolvedValueOnce(snapshot(0)).mockResolvedValueOnce(snapshot(1, 2500))
    .mockResolvedValue(snapshot(1, 20));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(600);
  expect(pressed).not.toHaveBeenCalled();
});

it('does not replay clicks after a failed request and reconnection', async () => {
  request.mockResolvedValueOnce(snapshot(1)).mockRejectedValueOnce(new Error('disconnected'))
    .mockResolvedValueOnce(snapshot(3)).mockResolvedValue(snapshot(4));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(2300);
  expect(pressed).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('cancels in-flight requests and ignores late results when leaving the session', async () => {
  let resolve: (value: unknown) => void = () => {};
  request.mockResolvedValueOnce(snapshot(0)).mockImplementation(() => new Promise(done => {resolve = done;}));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(300);
  const signal = request.mock.calls[1][5] as AbortSignal;
  stop();
  expect(signal.aborted).toBe(true);
  resolve(snapshot(1));
  await jest.advanceTimersByTimeAsync(5000);
  expect(pressed).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(2);
});

it('serializes requests and rejects a click delayed by a slow response', async () => {
  let resolve: (value: unknown) => void = () => {};
  request.mockResolvedValueOnce(snapshot(0)).mockImplementation(() => new Promise(done => {resolve = done;}));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(2400);
  expect(request).toHaveBeenCalledTimes(2);
  resolve(snapshot(1, 10));
  await flush();
  expect(pressed).not.toHaveBeenCalled();
});

it.each([
  {},
  {voice: {...snapshot(1).voice, ready: false}},
  {voice: {...snapshot(1).voice, presses: -1}},
  {voice: {...snapshot(1).voice, last_press_age_ms: '0'}},
  {voice: {...snapshot(1).voice, event_mode: undefined}},
  {voice: {...snapshot(1).voice, fault: undefined}},
  {voice: {...snapshot(1).voice, fault: 'unknown'}},
])('backs off when the firmware lacks a valid voice button status: %j', async value => {
  request.mockResolvedValue(value);
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(pressed).not.toHaveBeenCalled();
});

it.each(['stuck_input', 'conflicting_buttons'])('keeps polling %s and does not replay a click on recovery', async fault => {
  request.mockResolvedValueOnce(snapshot(0))
    .mockResolvedValueOnce({voice: {...snapshot(1).voice, fault}})
    .mockResolvedValueOnce(snapshot(1))
    .mockResolvedValue(snapshot(2));
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(600);
  expect(request).toHaveBeenCalledTimes(3);
  expect(warn).not.toHaveBeenCalled();
  expect(pressed).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(300);
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('stays responsive after an input fault lasting longer than the old backoff', async () => {
  request.mockResolvedValue({voice: {...snapshot(0).voice, fault: 'stuck_input'}});
  const pressed = jest.fn();
  stop = watchWifiLensButtons(pair, pressed);
  await jest.advanceTimersByTimeAsync(15000);
  expect(request).toHaveBeenCalledTimes(51);
  expect(pressed).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(snapshot(0)).mockResolvedValue(snapshot(1));
  await jest.advanceTimersByTimeAsync(600);
  expect(pressed).toHaveBeenCalledTimes(1);
});
