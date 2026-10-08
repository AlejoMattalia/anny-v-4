import type {LensPairing, LensStatus} from './LocalWifiLens';
import type {NetworkType, SavedNetwork} from '../types/savedNetwork';

export type NearbyLensNetwork = {
  ssid: string;
  signal: number;
  frequency?: number;
};
export type WifiLensConnection = {
  enabled: boolean;
  preference: NetworkType;
  phase: 'idle' | 'searching' | 'connecting' | 'connected' | 'disconnected';
  ssid: string;
  target: string;
  message: string;
  showDialog: boolean;
  session: LensPairing | null;
  networksMessage: string;
};
type Dependencies = {
  networks: () => Promise<SavedNetwork[]>;
  pairing: () => Promise<LensPairing | null>;
  scan: () => Promise<NearbyLensNetwork[]>;
  probe: (
    pair: LensPairing,
    signal: AbortSignal,
  ) => Promise<{address: string; state: LensStatus}>;
  configure: (
    pair: LensPairing | null,
    network: SavedNetwork,
    progress: (message: string) => void,
    signal: AbortSignal,
  ) => Promise<LensPairing>;
  save: (pair: LensPairing) => Promise<void>;
  phoneSSID?: () => Promise<string>;
  sync?: (pair: LensPairing, networks: SavedNetwork[], mode: NetworkType, signal: AbortSignal) => Promise<string>;
};

export function availableSavedNetworks(
  saved: SavedNetwork[],
  visible: NearbyLensNetwork[],
  mode: NetworkType,
) {
  const strengths = new Map<string, number>();
  for (const network of visible) {
    if (network.frequency && network.frequency >= 3000) {continue;}
    strengths.set(
      network.ssid,
      Math.max(strengths.get(network.ssid) ?? -Infinity, network.signal),
    );
  }
  // A phone cannot scan its own hotspot. For that case the lens performs the
  // scan/association and we require its confirmed SSID and reachable HTTP IP.
  return saved
    .filter(
      network =>
        network.type === mode &&
        (mode === 'hotspot' || strengths.has(network.ssid)),
    )
    .sort(
      (a, b) =>
        (strengths.get(b.ssid) ?? -200) - (strengths.get(a.ssid) ?? -200) ||
        b.createdAt - a.createdAt,
    );
}

/** One serialized connection owner for Home, Devices and app foregrounding. */
export class WifiLensConnectionManager {
  state: WifiLensConnection = {
    enabled: false,
    preference: 'wifi',
    phase: 'idle',
    ssid: '',
    target: '',
    message: '',
    showDialog: false,
    session: null,
    networksMessage: '',
  };
  private revision = 0;
  private controller: AbortController | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private running: Promise<boolean> | null = null;
  private active = true;
  private lastCameraFrameAt = 0;
  private recoveryArmed = false;
  private lastRecoveryAt = 0;
  private networksRevision = 1;
  private syncedRevision = 0;

  networksChanged() {
    ++this.networksRevision;
    this.update({networksMessage: 'Redes pendientes de guardar en los lentes…'});
    void this.poll(false);
  }

  private async syncNetworks(pair: LensPairing, signal: AbortSignal, current: () => boolean) {
    if (!this.deps.sync || this.syncedRevision === this.networksRevision || !current()) {return;}
    const revision = this.networksRevision;
    const mode = this.state.preference;
    try {
      const networks = await this.deps.networks();
      if (!current()) {return;}
      const message = await this.deps.sync(pair, networks, mode, signal);
      if (current()) {this.syncedRevision = revision; this.update({networksMessage: message});}
    } catch (error) {
      if (current()) {this.update({networksMessage: error instanceof Error
        ? `Sincronización pendiente: ${error.message}` : 'Redes pendientes de guardar en los lentes.'});}
    }
  }

  constructor(
    private deps: Dependencies,
    private changed: (state: WifiLensConnection) => void,
  ) {}

  private update(patch: Partial<WifiLensConnection>) {
    this.state = {...this.state, ...patch};
    this.changed(this.state);
  }

  setMode(enabled: boolean, preference: NetworkType, refresh = false) {
    if (enabled === this.state.enabled && preference === this.state.preference)
      {return;}
    this.cancel();
    this.lastCameraFrameAt = 0;
    this.recoveryArmed = false;
    ++this.networksRevision;
    this.update({
      enabled,
      preference,
      phase: enabled ? 'disconnected' : 'idle',
      ssid: '',
      target: '',
      session: null,
      message: '',
      showDialog: false,
      networksMessage: 'Redes pendientes de guardar en los lentes…',
    });
    if (enabled && this.active && refresh) {this.refresh();}
  }

  async switchNetworkType(preference: NetworkType) {
    if (!this.state.enabled || !this.active) {return false;}
    this.setMode(true, preference);
    // This is an explicit user action. Entering Devices still only reads state.
    return this.refresh(true, true, true);
  }

  foreground(active: boolean) {
    if (this.active === active) {return;}
    this.active = active;
    // Android's Wi-Fi approval dialog temporarily backgrounds Anny. Let the
    // explicit in-flight handoff finish; changing mode/unmount still cancels it.
    if (this.running) {return;}
    this.cancel();
    if (this.state.phase !== 'connected') {this.update({
      phase: this.state.enabled ? 'disconnected' : 'idle',
      ssid: '',
      session: null,
      target: '',
      message: '',
      showDialog: false,
    });}
    if (active && this.state.enabled) {this.poll();}
  }

  async refreshStatus() {
    this.cancel();
    if (this.state.phase !== 'connected') {
      this.update({phase: this.state.enabled ? 'disconnected' : 'idle', ssid: '',
        session: null, target: '', message: '', showDialog: false});
    }
    await this.poll(false);
  }

  /** Only actual displayed frames from a verified saved network prove liveness. */
  async trackCamera(pair: LensPairing, status: LensStatus): Promise<() => void> {
    const revision = this.revision;
    const mode = status.network_type || pair.networkType || this.state.preference;
    const saved = await this.deps.networks();
    if (!status.connected || !saved.some(network => network.type === mode && network.ssid === status.ssid) ||
        (status.network_type ? status.network_type !== mode : pair.networkType && pair.networkType !== mode)) {return () => {};}
    return () => {
      if (revision !== this.revision || !this.active || !this.state.enabled || this.running) {return;}
      this.lastCameraFrameAt = Date.now();
      if (this.state.phase === 'connected' && this.state.ssid === status.ssid &&
          this.state.session?.address === pair.address) {return;}
      this.update({phase: 'connected', ssid: status.ssid, target: '', showDialog: false,
        session: {...pair, networkType: mode}, message: `Conectado a ${status.ssid}`});
    };
  }

  private hasRecentCameraFrame() {
    return this.state.phase === 'connected' && this.lastCameraFrameAt > 0 &&
      Date.now() - this.lastCameraFrameAt < 6000;
  }

  cancel() {
    ++this.revision;
    this.controller?.abort();
    this.controller = null;
    this.running = null;
  }

  private async recoverReachableConnection(signal: AbortSignal, current: () => boolean, failure: string) {
    try {
      const pair = await this.deps.pairing();
      if (!pair || !current()) {return false;}
      const found = await this.deps.probe(pair, signal);
      if (!current() || !found.state.connected) {return false;}
      const saved = await this.deps.networks();
      const network = saved.find(value => value.ssid === found.state.ssid &&
        value.type === (found.state.network_type || pair.networkType || this.state.preference));
      if (!network || !current()) {return false;}
      const session = {...pair, address: found.address, networkType: network.type};
      await this.deps.save(session);
      if (!current()) {return false;}
      this.update({phase: 'connected', ssid: network.ssid, target: '', session, showDialog: false,
        message: `${failure} Seguís conectado a ${network.ssid}.`});
      return true;
    } catch {return false;}
  }

  private enqueue(
    manual: boolean,
    work: (signal: AbortSignal, current: () => boolean) => Promise<boolean>,
  ) {
    this.cancel();
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    const current = () =>
      revision === this.revision &&
      !controller.signal.aborted &&
      this.state.enabled;
    this.update({
      phase: 'searching',
      ssid: '',
      target: '',
      session: null,
      message: 'Buscando redes guardadas con señal…',
      showDialog: manual,
    });
    const pending = this.chain
      .catch(() => {})
      .then(async () => {
        if (!current()) {return false;}
        try {
          return await work(controller.signal, current);
        } catch (error) {
          const failure = error instanceof Error ? error.message : 'No se pudo cambiar de red.';
          if (current() && await this.recoverReachableConnection(controller.signal, current, failure)) {return false;}
          if (current())
            {this.update({
              phase: 'disconnected',
              ssid: '',
              session: null,
              target: '',
              showDialog: false,
              message:
                error instanceof Error
                  ? error.message
                  : 'No se pudo conectar con los lentes.',
            });}
          return false;
        } finally {
          if (revision === this.revision) {
            this.controller = null;
            this.running = null;
          }
        }
      });
    this.chain = pending;
    this.running = pending;
    return pending;
  }

  private async confirm(
    pair: LensPairing,
    network: SavedNetwork,
    signal: AbortSignal,
    current: () => boolean,
  ) {
    const found = await this.deps.probe(pair, signal);
    if (!current()) {return false;}
    if (!found.state.connected || found.state.ssid !== network.ssid)
      {throw new Error('Los lentes todavía no confirmaron la red seleccionada.');}
    const session = {
      ...pair,
      address: found.address,
      networkType: network.type,
    };
    await this.deps.save(session);
    if (!current()) {return false;}
    this.update({
      phase: 'connected',
      ssid: network.ssid,
      target: '',
      message: `Conectado a ${network.ssid}`,
      session,
      showDialog: false,
    });
    await this.syncNetworks(session, signal, current);
    return current();
  }

  private async connectCandidate(
    pair: LensPairing | null,
    network: SavedNetwork,
    signal: AbortSignal,
    current: () => boolean,
  ) {
    if (!current()) {return false;}
    this.update({
      phase: 'connecting',
      target: network.ssid,
      message: `Conectando a ${network.ssid}…`,
    });
    const configured = await this.deps.configure(
      pair,
      network,
      message => {
        if (current()) {this.update({message});}
      },
      signal,
    );
    if (!current()) {return false;}
    return this.confirm(configured, network, signal, current);
  }

  connect(network: SavedNetwork) {
    if (
      !this.state.enabled ||
      !this.active
    )
      {return Promise.resolve(false);}
    this.setMode(true, network.type);
    this.recoveryArmed = true;
    this.lastRecoveryAt = Date.now();
    ++this.networksRevision;
    return this.enqueue(true, async (signal, current) => {
      const pair = await this.deps.pairing();
      return this.connectCandidate(pair, network, signal, current);
    });
  }

  refresh(force = false, modal = true, switching = false): Promise<boolean> {
    if (!this.state.enabled || !this.active) {return Promise.resolve(false);}
    if (this.running && !force) {return this.running;}
    this.recoveryArmed = true;
    this.lastRecoveryAt = Date.now();
    ++this.networksRevision;
    return this.enqueue(modal, async (signal, current) => {
      const mode = this.state.preference;
      const saved = (await this.deps.networks()).filter(
        network => network.type === mode,
      );
      if (!current()) {return false;}
      if (!saved.length)
        {throw new Error(
          `No hay redes ${mode === 'wifi' ? 'WiFi' : 'Hotspot'} guardadas.`,
        );}
      const pair = await this.deps.pairing();
      if (!current()) {return false;}
      // A fresh scan on each foreground, but never reconfigure a valid link.
      const [scan, probe] = await Promise.allSettled([
        mode === 'wifi' ? this.deps.scan() : Promise.resolve([]),
        pair && (!switching || !pair.networkType || pair.networkType === mode)
          ? this.deps.probe(pair, signal) : Promise.resolve(null),
      ]);
      if (!current()) {return false;}
      if (
        pair &&
        probe.status === 'fulfilled' &&
        probe.value?.state.connected &&
        (probe.value.state.network_type ? probe.value.state.network_type === mode : !pair.networkType || pair.networkType === mode)
      ) {
        const network = saved.find(
          value => value.ssid === probe.value!.state.ssid,
        );
        if (network) {
          const session = {
            ...pair,
            address: probe.value.address,
            networkType: mode,
          };
          await this.deps.save(session);
          if (!current()) {return false;}
          this.update({
            phase: 'connected',
            ssid: network.ssid,
            target: '',
            session,
            message: `Conectado a ${network.ssid}`,
            showDialog: false,
          });
          await this.syncNetworks(session, signal, current);
          return current();
        }
      }
      let candidates = availableSavedNetworks(
        saved,
        scan.status === 'fulfilled' ? scan.value : [],
        mode,
      );
      // The phone's current LAN is the most likely reachable lens network.
      // A 5 GHz phone and a 2.4 GHz lens may share this same SSID/router.
      const phoneSSID = mode === 'wifi' && this.deps.phoneSSID ? await this.deps.phoneSSID().catch(() => '') : '';
      if (!current()) {return false;}
      const phoneNetwork = saved.find(network => network.ssid === phoneSSID);
      if (phoneNetwork) {candidates = [phoneNetwork, ...candidates.filter(network => network.id !== phoneNetwork.id)];}
      if (!candidates.length)
        {throw scan.status === 'rejected' ? scan.reason : new Error('No hay redes WiFi guardadas con señal.');}
      let lastError: unknown;
      for (const network of candidates) {
        if (!current()) {return false;}
        try {
          if (await this.connectCandidate(pair, network, signal, current))
            {return true;}
        } catch (error) {
          lastError = error;
        }
      }
      if (!current()) {return false;}
      throw (
        lastError || new Error('No se pudo conectar a las redes guardadas.')
      );
    });
  }

  /** Status polling stays passive unless startup/manual connection armed recovery. */
  async poll(allowRecovery = true) {
    if (!this.active || !this.state.enabled || this.running || this.controller) {return;}
    // Avoid competing HTTP traffic while fresh camera frames already prove the link.
    if (this.hasRecentCameraFrame() && this.syncedRevision === this.networksRevision) {return;}
    const revision = this.revision;
    const mode = this.state.preference;
    const controller = new AbortController();
    this.controller = controller;
    let recover = false;
    const current = () => revision === this.revision && !controller.signal.aborted && this.active && this.state.enabled;
    try {
      const saved = await this.deps.networks();
      if (!current()) {return;}
      const pair = this.state.session || await this.deps.pairing();
      if (!current()) {return;}
      if (!pair) {throw new Error('Lente no conectado. Conectalo desde Dispositivos.');}
      let found: Awaited<ReturnType<Dependencies['probe']>>;
      try {
        found = await this.deps.probe(pair, controller.signal);
      } catch (error) {
        if (current() && this.hasRecentCameraFrame()) {return;}
        // A closing camera session may still be draining the lens radio.
        // Confirm a transport failure before discarding an established link.
        // This only reads status: it never scans, joins Wi-Fi or provisions BLE.
        if (!current() || this.state.phase !== 'connected' || !this.state.session) {
          throw error;
        }
        await new Promise<void>(resolve => {
          const finish = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 750);
          controller.signal.addEventListener('abort', finish, {once: true});
        });
        if (!current()) {return;}
        try {
          found = await this.deps.probe(pair, controller.signal);
        } catch (retryError) {
          if (current() && this.hasRecentCameraFrame()) {return;}
          throw retryError;
        }
      }
      if (!current()) {return;}
      const actualType = found.state.network_type || pair.networkType || mode;
      const session = {...pair, address: found.address, networkType: actualType};
      // A reachable previous link remains a valid connection after a failed
      // change. The selected mode still controls the next requested connection.
      await this.syncNetworks(session, controller.signal, current);
      if (!current()) {return;}
      if (!found.state.connected || !saved.some(network => network.ssid === found.state.ssid && network.type === actualType)) {
        throw new Error('Lente no conectado. Conectalo desde Dispositivos.');
      }
      await this.deps.save(session);
      if (!current()) {return;}
      this.update({phase: 'connected', ssid: found.state.ssid, target: '', showDialog: false,
        session,
        message: `Conectado a ${found.state.ssid}`});
    } catch (error) {
      if (current()) {
        recover = allowRecovery && this.recoveryArmed && Date.now() - this.lastRecoveryAt >= 15000;
        this.update({phase: 'disconnected', ssid: '', session: null, target: '', showDialog: false,
          message: error instanceof Error ? error.message : 'Lente no conectado. Conectalo desde Dispositivos.'});
      }
    } finally {
      if (revision === this.revision) {this.controller = null;}
    }
    if (recover && current()) {await this.refresh(false, false);}
  }
}
