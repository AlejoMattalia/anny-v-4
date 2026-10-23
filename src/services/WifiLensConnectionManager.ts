import type {LensPairing, LensStatus} from './LocalWifiLens';
import type {NetworkType, SavedNetwork} from '../types/savedNetwork';

export type NearbyLensNetwork = {
  ssid: string;
  signal: number;
  frequency?: number;
};
export type WifiLensConnection = {
  enabled: boolean;
  manuallyDisconnected: boolean;
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
  saveDisconnected?: (disconnected: boolean) => Promise<void>;
  release?: () => Promise<void>;
  phoneSSID?: () => Promise<string>;
  sync?: (pair: LensPairing, networks: SavedNetwork[], mode: NetworkType, signal: AbortSignal) => Promise<string>;
};

const disconnectedMessage = 'Lentes desconectados. Tocá Conectar para volver a usarlos.';

function sessionForNetwork(pair: LensPairing, network: SavedNetwork, address = pair.address): LensPairing {
  return {...pair, address, networkType: network.type, ssid: network.ssid,
    hotspotSource: network.type === 'hotspot' ? network.hotspotSource : undefined};
}

function ownHotspot(saved: SavedNetwork[], mode: NetworkType, pair: LensPairing | null) {
  return mode === 'hotspot' && pair?.networkType === 'hotspot'
    ? saved.find(network => network.type === 'hotspot' && network.ssid === pair.ssid && network.hotspotSource === 'this-phone')
    : undefined;
}

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
    manuallyDisconnected: false,
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
  private cameraRevision = 0;
  private controller: AbortController | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private running: Promise<boolean> | null = null;
  private active = true;
  private lastCameraFrameAt = 0;
  private recoveryArmed = false;
  private lastRecoveryAt = 0;
  private networksRevision = 1;
  private syncedRevision = 0;
  private preferenceWrite: Promise<void> = Promise.resolve();

  async networksChanged() {
    ++this.networksRevision;
    if (this.state.manuallyDisconnected) {return;}
    // Saving credentials enables automatic connection even if startup had no
    // saved networks. A working connection is only synchronized by poll().
    this.recoveryArmed = true;
    this.lastRecoveryAt = -Infinity;
    this.update({networksMessage: 'Redes pendientes de guardar en los lentes…'});
    await this.poll();
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

  /** Restore before startup work is enabled; never probe a deliberately closed link. */
  restoreDisconnected(disconnected: boolean) {
    if (!disconnected) {return;}
    this.cancel();
    this.recoveryArmed = false;
    this.lastCameraFrameAt = 0;
    this.update({manuallyDisconnected: true, phase: 'disconnected', ssid: '', target: '',
      session: null, showDialog: false, message: disconnectedMessage});
  }

  private persistDisconnected(disconnected: boolean) {
    const next = this.preferenceWrite.catch(() => {}).then(() => this.deps.saveDisconnected?.(disconnected));
    this.preferenceWrite = next;
    return next;
  }

  async disconnect() {
    // Invalidate probes and frame callbacks immediately. Clearing the session
    // also removes button polling; cameras observe manuallyDisconnected.
    this.restoreDisconnected(true);
    const revision = this.revision;
    const saved = this.persistDisconnected(true);
    // A cancelled Android Wi-Fi handoff can finish late. Release its binding
    // after it settles and serialize any later explicit Connect behind this.
    const released = this.chain.catch(() => {}).then(() => this.deps.release?.());
    this.chain = released;
    const results = await Promise.allSettled([saved, released]);
    if (revision === this.revision && results.some(result => result.status === 'rejected')) {
      this.update({message: 'Lentes desconectados. No se pudo guardar o completar la desconexión; volvé a intentarlo antes de cerrar Anny.'});
    }
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
      message: this.state.manuallyDisconnected ? disconnectedMessage : '',
      showDialog: false,
      networksMessage: 'Redes pendientes de guardar en los lentes…',
    });
    if (enabled && this.active && refresh) {this.refresh();}
  }

  async switchNetworkType(preference: NetworkType) {
    if (!this.state.enabled || !this.active) {return false;}
    this.setMode(true, preference);
    if (this.state.manuallyDisconnected) {return false;}
    // This is an explicit user action. Entering Devices still only reads state.
    return this.refresh(true, true, true);
  }

  foreground(active: boolean) {
    if (this.active === active) {return;}
    this.active = active;
    if (this.state.manuallyDisconnected) {return;}
    // Android's Wi-Fi approval dialog temporarily backgrounds Anny. Let the
    // explicit in-flight handoff finish; changing mode/unmount still cancels it.
    if (this.running) {return;}
    // Backgrounding cancels status work, but the native camera survives it.
    // Keep accepting its frames when the app returns from hotspot settings.
    this.cancel(true);
    if (this.state.phase !== 'connected' && !this.state.showDialog) {this.update({
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
    if (this.state.manuallyDisconnected) {return;}
    this.cancel();
    if (this.state.phase !== 'connected') {
      this.update({phase: this.state.enabled ? 'disconnected' : 'idle', ssid: '',
        session: null, target: '', message: '', showDialog: false});
    }
    await this.poll(false);
  }

  dismissDialog() {
    this.update({showDialog: false});
  }

  /** Only actual displayed frames from a verified saved network prove liveness. */
  async trackCamera(pair: LensPairing, status: LensStatus): Promise<() => void> {
    if (this.state.manuallyDisconnected) {return () => {};}
    const revision = this.cameraRevision;
    const mode = status.network_type || pair.networkType || this.state.preference;
    const saved = await this.deps.networks();
    const network = saved.find(value => value.type === mode && value.ssid === status.ssid);
    const pinned = ownHotspot(saved, this.state.preference, pair);
    if (!status.connected || !network || (pinned && network.id !== pinned.id) ||
        (status.network_type ? status.network_type !== mode : pair.networkType && pair.networkType !== mode)) {return () => {};}
    return () => {
      if (revision !== this.cameraRevision || !this.active || !this.state.enabled || this.state.manuallyDisconnected || this.running) {return;}
      this.lastCameraFrameAt = Date.now();
      if (this.state.phase === 'connected' && this.state.ssid === status.ssid &&
          this.state.session?.address === pair.address) {return;}
      this.update({phase: 'connected', ssid: status.ssid, target: '', showDialog: false,
        session: sessionForNetwork(pair, network), message: `Conectado a ${status.ssid}`});
    };
  }

  private hasRecentCameraFrame() {
    return this.state.phase === 'connected' && this.lastCameraFrameAt > 0 &&
      Date.now() - this.lastCameraFrameAt < 6000;
  }

  cancel(preserveCamera = false) {
    ++this.revision;
    if (!preserveCamera) {++this.cameraRevision;}
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
      const pinned = ownHotspot(saved, this.state.preference, pair);
      const network = saved.find(value => value.ssid === found.state.ssid &&
        value.type === (found.state.network_type || pair.networkType || this.state.preference));
      if (!network || (pinned && network.id !== pinned.id) || !current()) {return false;}
      const session = sessionForNetwork(pair, network, found.address);
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
              showDialog: manual,
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
    const session = sessionForNetwork(pair, network, found.address);
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
    const resume = this.state.manuallyDisconnected;
    this.update({manuallyDisconnected: false});
    this.recoveryArmed = true;
    this.lastRecoveryAt = Date.now();
    ++this.networksRevision;
    return this.enqueue(true, async (signal, current) => {
      if (resume) {await this.persistDisconnected(false);}
      if (!current()) {return false;}
      const pair = await this.deps.pairing();
      return this.connectCandidate(pair, network, signal, current);
    });
  }

  refresh(force = false, modal = true, switching = false): Promise<boolean> {
    if (!this.state.enabled || !this.active) {return Promise.resolve(false);}
    const resume = this.state.manuallyDisconnected;
    if (resume && !force) {return Promise.resolve(false);}
    if (resume) {this.update({manuallyDisconnected: false});}
    if (this.running && !force) {return this.running;}
    this.recoveryArmed = true;
    this.lastRecoveryAt = Date.now();
    ++this.networksRevision;
    return this.enqueue(modal, async (signal, current) => {
      if (resume) {await this.persistDisconnected(false);}
      if (!current()) {return false;}
      const mode = this.state.preference;
      const saved = (await this.deps.networks()).filter(
        network => network.type === mode,
      );
      if (!current()) {return false;}
      if (!saved.length)
        {throw new Error(
          `No hay redes ${mode === 'wifi' ? 'WiFi' : 'Hotspot'} guardadas. Agregá el nombre y la contraseña desde Dispositivos.`,
        );}
      const pair = await this.deps.pairing();
      if (!current()) {return false;}
      const pinned = ownHotspot(saved, mode, pair);
      const eligible = pinned ? [pinned] : saved;
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
        const network = eligible.find(
          value => value.ssid === probe.value!.state.ssid,
        );
        if (network) {
          const session = sessionForNetwork(pair, network, probe.value.address);
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
        eligible,
        scan.status === 'fulfilled' ? scan.value : [],
        mode,
      );
      // The phone's current LAN is the most likely reachable lens network.
      // A 5 GHz phone and a 2.4 GHz lens may share this same SSID/router.
      const phoneSSID = mode === 'wifi' && this.deps.phoneSSID ? await this.deps.phoneSSID().catch(() => '') : '';
      if (!current()) {return false;}
      // A temporary loss must not send the lens to a different phone's hotspot.
      const previousHotspot = mode === 'hotspot' && pair?.networkType === mode
        ? candidates.find(network => network.ssid === pair.ssid) : undefined;
      if (previousHotspot) {candidates = [previousHotspot, ...candidates.filter(network => network.id !== previousHotspot.id)];}
      const phoneNetwork = saved.find(network => network.ssid === phoneSSID);
      if (phoneNetwork) {candidates = [phoneNetwork, ...candidates.filter(network => network.id !== phoneNetwork.id)];}
      if (!candidates.length && mode === 'wifi') {
        // Android can hide scan results/SSID even while connected. The lens
        // performs its own Wi-Fi association over BLE; its confirmed status,
        // not the phone's scan, decides whether a saved network is usable.
        candidates = [...saved].sort((a, b) => b.createdAt - a.createdAt);
      }
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

  /** Startup, saved-network edits and manual connections enable automatic recovery. */
  async poll(allowRecovery = true) {
    if (!this.active || !this.state.enabled || this.state.manuallyDisconnected || this.running || this.controller) {return;}
    // Keep a failed manual/startup attempt readable until the user acts.
    if (this.state.phase === 'disconnected' && this.state.showDialog) {return;}
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
      const network = saved.find(value => value.ssid === found.state.ssid && value.type === actualType);
      const pinned = ownHotspot(saved, mode, pair);
      if (!found.state.connected || !network || (pinned && network.id !== pinned.id)) {
        throw new Error(pinned ? `Esperando el hotspot ${pinned.ssid} de este celular.` : 'Lente no conectado. Conectalo desde Dispositivos.');
      }
      const session = sessionForNetwork(pair, network, found.address);
      // A reachable previous link remains a valid connection after a failed
      // change. The selected mode still controls the next requested connection.
      await this.syncNetworks(session, controller.signal, current);
      if (!current()) {return;}
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
