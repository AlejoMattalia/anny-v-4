import {
  availableSavedNetworks,
  WifiLensConnectionManager,
} from '../src/services/WifiLensConnectionManager';
import type {SavedNetwork} from '../src/types/savedNetwork';

const network = (
  ssid: string,
  type: 'wifi' | 'hotspot' = 'wifi',
): SavedNetwork => ({
  id: ssid + type,
  ssid,
  type,
  password: 'test',
  createdAt: 1,
});
const pair = {
  ap: 'Lentes-123abc',
  password: 'device',
  address: 'http://192.168.1.25',
  networkType: 'wifi' as const,
};
const status = (ssid: string, connected = true) => ({
  address: pair.address,
  state: {
    ssid,
    connected,
    camera: true,
    ap_active: false,
    ip: '192.168.1.25',
    hostname: pair.ap,
    saved: true,
    result: 'saved',
  },
});
function setup(saved = [network('Home')]) {
  const deps = {
    networks: jest.fn().mockResolvedValue(saved),
    pairing: jest.fn().mockResolvedValue(pair),
    scan: jest
      .fn()
      .mockResolvedValue([{ssid: 'Home', signal: -40, frequency: 2412}]),
    probe: jest.fn().mockResolvedValue(status('Home')),
    configure: jest.fn().mockResolvedValue(pair),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const manager = new WifiLensConnectionManager(deps, jest.fn());
  manager.setMode(true, 'wifi', false);
  return {deps, manager};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

it('filters saved networks by selected mode, presence and 2.4 GHz signal strength', () => {
  const saved = [
    network('Weak'),
    network('Strong'),
    network('Absent'),
    network('5GHz'),
    network('Phone', 'hotspot'),
  ];
  const visible = [
    {ssid: 'Weak', signal: -80},
    {ssid: 'Strong', signal: -35},
    {ssid: 'Unknown', signal: -20},
    {ssid: '5GHz', signal: -25, frequency: 5200},
  ];
  expect(
    availableSavedNetworks(saved, visible, 'wifi').map(n => n.ssid),
  ).toEqual(['Strong', 'Weak']);
  expect(availableSavedNetworks(saved, [], 'hotspot').map(n => n.ssid)).toEqual(
    ['Phone'],
  );
});
it('freshly scans and confirms a saved lens on startup without reconfiguring a valid link', async () => {
  const {manager, deps} = setup();
  expect(await manager.refresh()).toBe(true);
  expect(deps.scan).toHaveBeenCalledTimes(1);
  expect(deps.configure).not.toHaveBeenCalled();
  expect(manager.state).toMatchObject({
    phase: 'connected',
    ssid: 'Home',
    showDialog: false,
  });
});
it('rejects a stale pairing when no saved network has signal', async () => {
  const {manager, deps} = setup();
  deps.probe.mockRejectedValue(new Error('offline'));
  deps.scan.mockResolvedValue([]);
  expect(await manager.refresh()).toBe(false);
  expect(manager.state.phase).toBe('disconnected');
  expect(deps.configure).not.toHaveBeenCalled();
});
it('tries the strongest visible saved network and continues after a failed password', async () => {
  const {manager, deps} = setup([network('Strong'), network('Home')]);
  deps.probe.mockRejectedValueOnce(new Error('offline'));
  deps.scan.mockResolvedValue([
    {ssid: 'Strong', signal: -20},
    {ssid: 'Home', signal: -70},
  ]);
  deps.configure.mockRejectedValueOnce(new Error('bad password'));
  expect(await manager.refresh()).toBe(true);
  expect(deps.configure.mock.calls.map(call => call[1].ssid)).toEqual([
    'Strong',
    'Home',
  ]);
});
it('uses only saved hotspots even when the phone cannot scan its own hotspot', async () => {
  const {manager, deps} = setup([network('Home'), network('Phone', 'hotspot')]);
  manager.setMode(true, 'hotspot', false);
  deps.scan.mockRejectedValue(new Error('hotspot active'));
  deps.probe
    .mockResolvedValueOnce(status('Home'))
    .mockResolvedValue(status('Phone'));
  expect(await manager.refresh()).toBe(true);
  expect(deps.configure.mock.calls[0][1].ssid).toBe('Phone');
  expect(manager.state).toMatchObject({
    phase: 'connected',
    preference: 'hotspot',
    ssid: 'Phone',
  });
});
it('does not fall back to WiFi when no hotspots are saved', async () => {
  const {manager, deps} = setup();
  manager.setMode(true, 'hotspot', false);
  expect(await manager.refresh()).toBe(false);
  expect(deps.configure).not.toHaveBeenCalled();
  expect(manager.state.message).toContain('Hotspot');
});
it('uses the connection dialog for manual connections and checks the exact SSID', async () => {
  const {manager, deps} = setup();
  deps.probe.mockResolvedValue(status('Wrong network'));
  const pending = manager.connect(network('Home'));
  expect(manager.state.showDialog).toBe(true);
  expect(await pending).toBe(false);
  expect(manager.state).toMatchObject({
    phase: 'disconnected',
    ssid: '',
    showDialog: false,
  });
});
it('deduplicates simultaneous automatic requests', async () => {
  const {manager, deps} = setup();
  await Promise.all([manager.refresh(), manager.refresh()]);
  expect(deps.scan).toHaveBeenCalledTimes(1);
});
it('checks status on foreground without reconnecting or scanning', async () => {
  const {manager, deps} = setup();
  await manager.refresh();
  manager.foreground(false);
  // Current v3 preserves a verified connection while backgrounded.
  expect(manager.state.ssid).toBe('Home');
  deps.probe.mockRejectedValue(new Error('offline'));
  deps.scan.mockResolvedValue([]);
  jest.useFakeTimers();
  try {
    manager.foreground(true);
    await jest.advanceTimersByTimeAsync(800);
  } finally { jest.useRealTimers(); }
  expect(deps.probe).toHaveBeenCalledTimes(3);
  expect(deps.scan).toHaveBeenCalledTimes(1);
  expect(deps.configure).not.toHaveBeenCalled();
  expect(manager.state.phase).toBe('disconnected');
});
it('ignores late connection results after switching modes and serializes BLE work', async () => {
  const {manager, deps} = setup([network('Home'), network('Phone', 'hotspot')]);
  let finish!: (value: typeof pair) => void;
  deps.configure.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const old = manager.connect(network('Home'));
  await tick();
  const signal = deps.configure.mock.calls[0][3];
  manager.setMode(true, 'hotspot', false);
  const next = manager.connect(network('Phone', 'hotspot'));
  await tick();
  expect(signal.aborted).toBe(true);
  expect(deps.configure).toHaveBeenCalledTimes(1);
  deps.probe.mockResolvedValue(status('Phone'));
  finish(pair);
  expect(await old).toBe(false);
  expect(await next).toBe(true);
  expect(manager.state).toMatchObject({ssid: 'Phone', preference: 'hotspot'});
});
it('detects a lost lens without starting another connection attempt', async () => {
  const {manager, deps} = setup();
  await manager.refresh();
  deps.probe.mockRejectedValue(new Error('offline'));
  deps.scan.mockResolvedValue([]);
  await manager.poll();
  expect(manager.state.phase).toBe('disconnected');
  await manager.poll();
  expect(deps.scan).toHaveBeenCalledTimes(1);
  expect(deps.configure).not.toHaveBeenCalled();
});
it('stops all automatic work when Bluetooth is selected', async () => {
  const {manager, deps} = setup();
  manager.setMode(false, 'wifi');
  manager.foreground(true);
  await manager.poll();
  await manager.refresh();
  expect(deps.scan).not.toHaveBeenCalled();
  expect(deps.configure).not.toHaveBeenCalled();
});

it.each([true, false])('shows the connection modal only when requested (modal=%s)', async modal => {
  const {manager} = setup();
  const pending = manager.refresh(false, modal);
  expect(manager.state.phase).toBe('searching');
  expect(manager.state.showDialog).toBe(modal);
  await pending;
  expect(manager.state.showDialog).toBe(false);
});
