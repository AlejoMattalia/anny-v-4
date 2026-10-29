import { State, type BleManager } from 'react-native-ble-plx';
import { waitForLensBluetooth } from '../src/services/LensBluetoothState';

jest.mock('react-native-ble-plx', () => ({ State: { Unknown: 'unknown', Resetting: 'resetting', PoweredOn: 'on', PoweredOff: 'off', Unauthorized: 'unauthorized' } }));
let listener: (state: State) => void;
const remove = jest.fn();
const ble = { state: jest.fn(), onStateChange: jest.fn((callback: typeof listener) => { listener = callback; return { remove }; }) };
const ready = (signal = new AbortController().signal) => waitForLensBluetooth(ble as unknown as BleManager, signal);
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); ble.state.mockResolvedValue(State.Unknown); });
afterEach(() => jest.useRealTimers());

it('waits for the first iOS authorization and cleans the listener after Bluetooth powers on', async () => {
  const pending = ready(); await jest.advanceTimersByTimeAsync(0);
  listener(State.Resetting); expect(remove).not.toHaveBeenCalled();
  listener(State.PoweredOn); await pending;
  expect(remove).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
it('reports denied authorization separately from a disabled radio', async () => {
  const result = expect(ready()).rejects.toThrow('Permití Bluetooth');
  await jest.advanceTimersByTimeAsync(0); listener(State.Unauthorized); await result;
  expect(remove).toHaveBeenCalledTimes(1);
});
it('cancels while waiting for iOS permission without leaving a listener', async () => {
  const controller = new AbortController(); const result = expect(ready(controller.signal)).rejects.toThrow('cancelada');
  await jest.advanceTimersByTimeAsync(0); controller.abort(); await result;
  expect(remove).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
it('bounds an initialization that never completes', async () => {
  const result = expect(ready()).rejects.toThrow('no terminó');
  await jest.advanceTimersByTimeAsync(60000); await result;
  expect(remove).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
it('uses an already powered radio without waiting for another event', async () => {
  ble.state.mockResolvedValue(State.PoweredOn); await ready();
  expect(ble.onStateChange).not.toHaveBeenCalled();
});
it('reports Bluetooth off without starting a scan', async () => {
  ble.state.mockResolvedValue(State.PoweredOff); await expect(ready()).rejects.toThrow('Activá Bluetooth');
  expect(ble.onStateChange).not.toHaveBeenCalled();
});
