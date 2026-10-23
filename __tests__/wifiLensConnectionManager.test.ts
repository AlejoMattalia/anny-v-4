import {
  availableSavedNetworks,
  WifiLensConnectionManager,
} from '../src/services/WifiLensConnectionManager';
import type {SavedNetwork} from '../src/types/savedNetwork';
import type {LensPairing} from '../src/services/LocalWifiLens';

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
    pairing: jest.fn<Promise<LensPairing | null>, []>().mockResolvedValue(pair),
    scan: jest
      .fn()
      .mockResolvedValue([{ssid: 'Home', signal: -40, frequency: 2412}]),
    probe: jest.fn().mockResolvedValue(status('Home')),
    configure: jest.fn().mockResolvedValue(pair),
    save: jest.fn().mockResolvedValue(undefined),
    saveDisconnected: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const manager = new WifiLensConnectionManager(deps, jest.fn());
  manager.setMode(true, 'wifi', false);
  return {deps, manager};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

it('disconnects, releases the route and rejects all automatic recovery and camera frames', async () => {
  const {manager, deps} = setup();
  await manager.refresh();
  const frame = await manager.trackCamera(pair, status('Home').state);
  const probes = deps.probe.mock.calls.length;
  await manager.disconnect();
  expect(manager.state).toMatchObject({phase: 'disconnected', manuallyDisconnected: true, session: null, ssid: '', showDialog: false});
  expect(deps.release).toHaveBeenCalledTimes(1);
  expect(deps.saveDisconnected).toHaveBeenLastCalledWith(true);
  frame();
  const lateFrame = await manager.trackCamera(pair, status('Home').state);
  lateFrame();
  manager.foreground(false);
  manager.foreground(true);
  await manager.networksChanged();
  await manager.refreshStatus();
  await manager.poll();
  expect(await manager.refresh(false, true)).toBe(false);
  expect(deps.probe).toHaveBeenCalledTimes(probes);
  expect(deps.configure).not.toHaveBeenCalled();
  expect(manager.state.phase).toBe('disconnected');
});

it('restores a manual disconnect before startup and keeps it when selecting a network type', async () => {
  const {deps} = setup();
  const manager = new WifiLensConnectionManager(deps, jest.fn());
  manager.restoreDisconnected(true);
  manager.setMode(true, 'wifi', true);
  await manager.poll();
  await manager.switchNetworkType('hotspot');
  expect(manager.state).toMatchObject({manuallyDisconnected: true, preference: 'hotspot', session: null});
  expect(deps.probe).not.toHaveBeenCalled();
  expect(deps.scan).not.toHaveBeenCalled();
  expect(deps.configure).not.toHaveBeenCalled();
});

it.each(['connect', 'retry'])('resumes only on explicit %s and preserves saved credentials', async action => {
  const {manager, deps} = setup();
  await manager.disconnect();
  const result = action === 'connect' ? await manager.connect(network('Home')) : await manager.refresh(true, true);
  expect(result).toBe(true);
  expect(manager.state).toMatchObject({phase: 'connected', manuallyDisconnected: false, ssid: 'Home'});
  expect(deps.saveDisconnected.mock.calls.map(call => call[0])).toEqual([true, false]);
  expect(deps.save).toHaveBeenLastCalledWith(expect.objectContaining({ap: pair.ap, password: pair.password}));
});

it('cancels an in-flight connection and releases its late Wi-Fi handoff before reconnecting', async () => {
  const {manager, deps} = setup();
  let finish!: (value: LensPairing) => void;
  deps.configure.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const connecting = manager.connect(network('Home'));
  await tick();
  const signal = deps.configure.mock.calls[0][3] as AbortSignal;
  const disconnecting = manager.disconnect();
  expect(signal.aborted).toBe(true);
  expect(manager.state.manuallyDisconnected).toBe(true);
  const reconnecting = manager.connect(network('Home'));
  expect(deps.configure).toHaveBeenCalledTimes(1);
  finish(pair);
  expect(await connecting).toBe(false);
  await disconnecting;
  expect(await reconnecting).toBe(true);
  expect(deps.release.mock.invocationCallOrder[0]).toBeLessThan(deps.configure.mock.invocationCallOrder[1]);
  expect(deps.saveDisconnected.mock.calls.map(call => call[0])).toEqual([true, false]);
});

it('ignores a successful status response that arrives after disconnecting', async () => {
  const {manager, deps} = setup();
  let finish!: (value: ReturnType<typeof status>) => void;
  deps.probe.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const polling = manager.poll();
  await tick();
  await manager.disconnect();
  finish(status('Home'));
  await polling;
  expect(manager.state).toMatchObject({manuallyDisconnected: true, phase: 'disconnected', session: null});
  expect(deps.save).not.toHaveBeenCalled();
});

it('keeps the link closed and reports a failure to persist the disconnect', async () => {
  const {manager, deps} = setup();
  deps.saveDisconnected.mockRejectedValueOnce(new Error('storage unavailable'));
  await manager.disconnect();
  await manager.poll();
  expect(manager.state.manuallyDisconnected).toBe(true);
  expect(manager.state.message).toContain('No se pudo guardar');
  expect(deps.probe).not.toHaveBeenCalled();
});

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
it('does not mark a stale pairing connected when a saved network cannot be confirmed', async () => {
  const {manager, deps} = setup();
  deps.probe.mockRejectedValue(new Error('offline'));
  deps.scan.mockResolvedValue([]);
  expect(await manager.refresh()).toBe(false);
  expect(manager.state.phase).toBe('disconnected');
  expect(deps.configure).toHaveBeenCalledTimes(1);
  expect(deps.save).not.toHaveBeenCalled();
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
  expect(deps.scan).not.toHaveBeenCalled();
  expect(manager.state).toMatchObject({
    phase: 'connected',
    preference: 'hotspot',
    ssid: 'Phone',
  });
});

it('keeps accepting live hotspot frames after returning from phone settings', async () => {
  jest.useFakeTimers();
  try {
    const {manager, deps} = setup([network('Phone', 'hotspot')]);
    const hotspotPair = {...pair, networkType: 'hotspot' as const};
    deps.pairing.mockResolvedValue(hotspotPair);
    deps.probe.mockResolvedValue(status('Phone'));
    manager.setMode(true, 'hotspot');
    await manager.refresh();
    const reportFrame = await manager.trackCamera(hotspotPair, status('Phone').state);
    manager.foreground(false);
    await jest.advanceTimersByTimeAsync(30000);
    manager.foreground(true);
    await jest.advanceTimersByTimeAsync(0);
    reportFrame();
    deps.probe.mockRejectedValue(new Error('status busy while video still arrives'));
    const polling = manager.poll();
    await jest.advanceTimersByTimeAsync(800);
    await polling;
    expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Phone'});
    expect(deps.configure).not.toHaveBeenCalled();
    expect(deps.scan).not.toHaveBeenCalled();
  } finally {jest.useRealTimers();}
});

it('ignores old camera frames after an explicit network mode change', async () => {
  const {manager} = setup();
  await manager.refresh();
  const reportFrame = await manager.trackCamera(pair, status('Home').state);
  manager.setMode(true, 'hotspot');
  reportFrame();
  expect(manager.state).toMatchObject({phase: 'disconnected', preference: 'hotspot', session: null});
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
    showDialog: true,
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

it('automatically connects a newly saved network without requiring Connect or a previous pairing', async () => {
  const {manager, deps} = setup([network('Office')]);
  deps.pairing.mockResolvedValue(null);
  deps.scan.mockResolvedValue([{ssid: 'Office', signal: -45, frequency: 2412}]);
  deps.probe.mockResolvedValue(status('Office'));
  await manager.networksChanged();
  expect(deps.configure).toHaveBeenCalledWith(null, network('Office'), expect.any(Function), expect.any(AbortSignal));
  expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Office', showDialog: false});
});

it('synchronizes an added network while preserving a working connection', async () => {
  const sync = jest.fn().mockResolvedValue('Redes guardadas');
  const {deps} = setup();
  const manager = new WifiLensConnectionManager({...deps, sync}, jest.fn());
  manager.setMode(true, 'wifi');
  await manager.refresh();
  deps.networks.mockResolvedValue([network('Home'), network('Office')]);
  await manager.networksChanged();
  expect(sync).toHaveBeenLastCalledWith(expect.objectContaining(pair), [network('Home'), network('Office')], 'wifi', expect.any(AbortSignal));
  expect(deps.configure).not.toHaveBeenCalled();
  expect(deps.scan).toHaveBeenCalledTimes(1);
  expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Home'});
});

it('automatically retries a saved network when it becomes available later', async () => {
  jest.useFakeTimers();
  try {
    const {manager, deps} = setup([network('Office')]);
    deps.pairing.mockResolvedValue(null);
    deps.scan.mockResolvedValue([]);
    deps.configure.mockRejectedValueOnce(new Error('El lente no encuentra esa red todavía'));
    await manager.networksChanged();
    expect(deps.configure).toHaveBeenCalledTimes(1);
    expect(manager.state.phase).toBe('disconnected');
    deps.scan.mockResolvedValue([{ssid: 'Office', signal: -45, frequency: 2412}]);
    deps.probe.mockResolvedValue(status('Office'));
    await manager.poll();
    expect(deps.configure).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15000);
    await manager.poll();
    expect(deps.configure).toHaveBeenCalledTimes(2);
    expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Office'});
  } finally {jest.useRealTimers();}
});

it('automatically moves from a lost WiFi connection to another saved network', async () => {
  jest.useFakeTimers();
  try {
    const {manager, deps} = setup([network('Home'), network('Office')]);
    await manager.refresh();
    deps.scan.mockResolvedValue([{ssid: 'Office', signal: -45, frequency: 2412}]);
    deps.probe.mockRejectedValue(new Error('Home is no longer reachable'));
    deps.configure.mockImplementation(async () => {
      deps.probe.mockResolvedValue(status('Office'));
      return pair;
    });
    await jest.advanceTimersByTimeAsync(15000);
    const pending = manager.poll();
    await jest.advanceTimersByTimeAsync(750);
    await pending;
    expect(deps.configure).toHaveBeenCalledWith(pair, network('Office'), expect.any(Function), expect.any(AbortSignal));
    expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Office', showDialog: false});
  } finally {jest.useRealTimers();}
});

it('defers an automatic connection saved in the background until foreground', async () => {
  const {manager, deps} = setup([network('Office')]);
  deps.pairing.mockResolvedValue(null);
  deps.scan.mockResolvedValue([{ssid: 'Office', signal: -45, frequency: 2412}]);
  deps.probe.mockResolvedValue(status('Office'));
  manager.foreground(false);
  await manager.networksChanged();
  expect(deps.configure).not.toHaveBeenCalled();
  manager.foreground(true);
  await tick();
  expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Office'});
});

it.each(['empty', 'denied', 'only-5GHz'])('uses BLE with saved WiFi when Android scan is %s', async scanResult => {
  const {manager, deps} = setup([network('Office')]);
  deps.pairing.mockResolvedValue(null);
  if (scanResult === 'denied') deps.scan.mockRejectedValue(new Error('Permití ubicación'));
  else deps.scan.mockResolvedValue(scanResult === 'empty' ? [] : [{ssid: 'Office', signal: -40, frequency: 5200}]);
  deps.probe.mockResolvedValue(status('Office'));
  expect(await manager.refresh()).toBe(true);
  expect(deps.configure).toHaveBeenCalledWith(null, network('Office'), expect.any(Function), expect.any(AbortSignal));
  expect(manager.state).toMatchObject({phase: 'connected', ssid: 'Office'});
});

it('preserves a failed manual attempt until dismissal and allows a successful retry', async () => {
  const {manager, deps} = setup();
  deps.pairing.mockResolvedValue(null);
  deps.configure.mockRejectedValueOnce(new Error('Activá Bluetooth para encontrar los lentes.'));
  expect(await manager.connect(network('Home'))).toBe(false);
  const failure = manager.state.message;
  await manager.poll();
  manager.foreground(false);
  manager.foreground(true);
  await tick();
  expect(manager.state).toMatchObject({phase: 'disconnected', message: failure, showDialog: true});
  manager.dismissDialog();
  expect(manager.state).toMatchObject({message: failure, showDialog: false});
  expect(await manager.refresh(true, true)).toBe(true);
  expect(manager.state).toMatchObject({phase: 'connected', showDialog: false});
});

it('does not open an error modal for a failed automatic connection', async () => {
  const {manager, deps} = setup();
  deps.pairing.mockResolvedValue(null);
  deps.configure.mockRejectedValue(new Error('Lentes apagados'));
  await manager.networksChanged();
  expect(manager.state).toMatchObject({phase: 'disconnected', message: 'Lentes apagados', showDialog: false});
});

function ownPhoneSetup() {
  const own: SavedNetwork = {...network('My phone', 'hotspot'), hotspotSource: 'this-phone'};
  const other: SavedNetwork = {...network('Other phone', 'hotspot'), hotspotSource: 'other-phone', createdAt: 100};
  const previous: LensPairing = {...pair, ssid: own.ssid, networkType: 'hotspot', hotspotSource: 'this-phone'};
  const {manager, deps} = setup([other, own]);
  manager.setMode(true, 'hotspot');
  deps.pairing.mockResolvedValue(previous);
  deps.probe.mockResolvedValue(status(own.ssid));
  return {manager, deps, own, other, previous};
}

it('recovers the saved own-phone hotspot before a newer alternative after app restart', async () => {
  const {manager, deps, own} = ownPhoneSetup();
  deps.probe.mockRejectedValueOnce(new Error('temporary outage'));
  expect(await manager.refresh()).toBe(true);
  expect(deps.configure.mock.calls.map(call => call[1].ssid)).toEqual([own.ssid]);
  expect(deps.save).toHaveBeenLastCalledWith(expect.objectContaining({ssid: own.ssid, hotspotSource: 'this-phone'}));
  expect(deps.scan).not.toHaveBeenCalled();
});

it('does not move the glasses to another phone when the own hotspot is temporarily unavailable', async () => {
  const {manager, deps, own} = ownPhoneSetup();
  deps.probe.mockRejectedValue(new Error('offline'));
  deps.configure.mockRejectedValue(new Error('Activá el hotspot de este celular'));
  expect(await manager.refresh(false, false)).toBe(false);
  expect(deps.configure.mock.calls.map(call => call[1].ssid)).toEqual([own.ssid]);
  expect(deps.save).not.toHaveBeenCalled();
  expect(manager.state.phase).toBe('disconnected');
});

it('still allows explicitly connecting to a different hotspot', async () => {
  const {manager, deps, other} = ownPhoneSetup();
  deps.probe.mockResolvedValue(status(other.ssid));
  expect(await manager.connect(other)).toBe(true);
  expect(deps.configure.mock.calls[0][1]).toEqual(other);
  expect(manager.state.session).toMatchObject({ssid: other.ssid, hotspotSource: 'other-phone'});
});

it('does not adopt an alternative chosen by older firmware during a hotspot outage', async () => {
  const {manager, deps, other} = ownPhoneSetup();
  await manager.refresh();
  deps.save.mockClear();
  deps.probe.mockResolvedValue(status(other.ssid));
  await manager.poll(false);
  expect(deps.save).not.toHaveBeenCalled();
  expect(manager.state.phase).toBe('disconnected');
  expect(manager.state.message).toContain('My phone');
});

it('releases the own-hotspot preference when that saved network is removed', async () => {
  const {manager, deps, other} = ownPhoneSetup();
  deps.networks.mockResolvedValue([other]);
  deps.probe.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(status(other.ssid));
  expect(await manager.refresh()).toBe(true);
  expect(deps.configure.mock.calls[0][1]).toEqual(other);
});
