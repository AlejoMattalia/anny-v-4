import {Buffer} from 'buffer';
import {PermissionsAndroid, Platform} from 'react-native';
import {BleManager, Device, ScanMode, State} from 'react-native-ble-plx';
import {LensDiscoveryError, waitForLensOperation} from './lensOperation';

const SERVICE = 'e7a20001-8f21-4c7d-9b32-1c9a52f00100';
const RX = 'e7a20002-8f21-4c7d-9b32-1c9a52f00100';
const TX = 'e7a20003-8f21-4c7d-9b32-1c9a52f00100';
const ACCESS = 'e7a20004-8f21-4c7d-9b32-1c9a52f00100';
let manager: BleManager | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const validateLensWifi = (ssid: string, password: string) => {
  const name = Buffer.from(ssid, 'utf8');
  const pass = Buffer.from(password, 'utf8');
  if (
    !name.length ||
    name.length > 32 ||
    name.some(byte => byte < 32 || byte === 127) ||
    pass.some(byte => byte < 32 || byte === 127) ||
    (pass.length !== 0 && (pass.length < 8 || pass.length > 63))
  ) {
    throw new Error('Revisá el nombre y la contraseña de tu red de 2,4 GHz.');
  }
};
export async function discoverAndConfigureLens(
  ssid: string,
  password: string,
  onProgress: (value: string) => void,
  signal: AbortSignal,
  knownId?: string,
  networkType: 'wifi' | 'hotspot' = 'wifi',
) {
  validateLensWifi(ssid, password);
  const check = () => {
    if (signal.aborted) {
      throw new Error('Conexión cancelada.');
    }
  };
  if (Platform.OS === 'android') {
    const permissions =
      Number(Platform.Version) >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const granted = await waitForLensOperation(() => PermissionsAndroid.requestMultiple(permissions), signal, 60000,
      'La solicitud de permisos Bluetooth tardó demasiado. Volvé a intentar.');
    if (
      permissions.some(
        permission =>
          granted[permission] !== PermissionsAndroid.RESULTS.GRANTED,
      )
    ) {
      throw new LensDiscoveryError(
        'Permití dispositivos cercanos para encontrar tus lentes.',
      );
    }
  }
  check();
  if (!manager) {
    manager = new BleManager();
  }
  const ble = manager;
  if ((await waitForLensOperation(() => ble.state(), signal, 5000,
    'Bluetooth no respondió. Apagalo, volvé a activarlo y reintentá.')) !== State.PoweredOn) {
    throw new LensDiscoveryError(
      'Activá Bluetooth para que Anny encuentre los lentes. El video se transmite por Wi-Fi.',
    );
  }
  let device: Device | null = null;
  onProgress('Buscando tus lentes…');
  for (let attempt = 1; attempt <= 3 && !device; attempt++) {
    check();
    device = await new Promise<Device | null>((resolve, reject) => {
      let done = false;
      const finish = (found?: Device, error?: Error) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        // stopDeviceScan is asynchronous in current ble-plx. Finish stopping
        // before a retry starts, and never let a rejected stop hang the owner.
        void waitForLensOperation(() => Promise.resolve(ble.stopDeviceScan()), undefined, 3000,
          'No se pudo detener la búsqueda Bluetooth.').then(() => {
          if (error) reject(error);
          else resolve(found ?? null);
        }, stopError => reject(error ?? new LensDiscoveryError(stopError instanceof Error
          ? stopError.message : 'No se pudo detener la búsqueda Bluetooth.')));
      };
      const cancel = () => finish(undefined, new Error('Conexión cancelada.'));
      const timer = setTimeout(() => finish(), 20000);
      signal.addEventListener('abort', cancel);
      if (signal.aborted) {cancel(); return;}
      const scanFailed = () => finish(undefined, new LensDiscoveryError(
        'No se pudo buscar el lente. Revisá Bluetooth y los permisos.',
      ));
      // Samsung can exhaust hardware filter slots while other apps scan.
      // Filter in JS on Android, keeping the saved device identity or the
      // provisioning service for first pairing. GATT is verified before writing.
      try {
        void Promise.resolve(ble.startDeviceScan(Platform.OS === 'android' ? null : [SERVICE], {scanMode: ScanMode.LowLatency}, (error, found) => {
          if (done) return;
          if (error) {
            scanFailed();
            return;
          }
          if (!found) return;
          const matches = knownId ? found.id.toLowerCase() === knownId.toLowerCase()
            : found.serviceUUIDs?.some(uuid => uuid.toLowerCase() === SERVICE);
          if (matches) {finish(found);}
        })).catch(scanFailed);
      } catch {scanFailed();}
    });
  }
  check();
  if (!device) {
    throw new LensDiscoveryError('No se encontraron los lentes por Bluetooth. Acercalos al celular y tocá Reintentar.');
  }
  const discoveredDevice = device;
  let connected: Device | null = null;
  const step = <T>(work: () => Promise<T>, message: string, timeout = 15000) =>
    waitForLensOperation(work, signal, timeout, message);
  const cancel = () => {
    void ble.cancelDeviceConnection(discoveredDevice.id).catch(() => {});
  };
  signal.addEventListener('abort', cancel);
  try {
    check();
    onProgress('Conectando con tus lentes…');
    connected = await step(() => discoveredDevice.connect({timeout: 15000}), 'El lente no respondió a la conexión Bluetooth.');
    const link = connected;
    await step(() => link.discoverAllServicesAndCharacteristics(), 'El lente no respondió al consultar sus servicios Bluetooth.');
    if (Platform.OS === 'android') {
      connected = await step(() => link.requestMTU(247), 'El lente no respondió al preparar Bluetooth.', 10000);
    }
    // Encrypted GATT performs automatic system pairing. No device code is shown or entered in Anny.
    const access = await step(() => connected!.readCharacteristicForService(
      SERVICE,
      ACCESS,
    ), 'El lente no respondió a la vinculación Bluetooth.');
    if (!access.value) {
      throw new Error('Los lentes no respondieron. Volvé a intentar.');
    }
    const credential = Buffer.from(access.value, 'base64').toString('utf8');
    // New lenses advertise typed credentials; old firmware keeps its packet.
    const capability = await step(() => connected!.readCharacteristicForService(SERVICE, TX),
      'El lente no respondió al consultar la conexión.');
    const multi = capability.value
      ? JSON.parse(Buffer.from(capability.value, 'base64').toString('utf8')).multi === 1
      : false;
    const name = Buffer.from(ssid, 'utf8');
    const pass = Buffer.from(password, 'utf8');
    const id = Math.floor(Math.random() * 0xffffffff) || 1;
    const offset = multi ? 6 : 5;
    const packet = Buffer.alloc(offset + name.length + pass.length);
    packet.writeUInt32LE(id, 0);
    packet[4] = name.length | (multi ? 0x80 : 0);
    if (multi) {packet[5] = networkType === 'hotspot' ? 1 : 0;}
    name.copy(packet, offset);
    pass.copy(packet, offset + name.length);
    check();
    await step(() => connected!.writeCharacteristicWithResponseForService(
      SERVICE,
      RX,
      packet.toString('base64'),
    ), 'El lente no confirmó la recepción de la red.');
    packet.fill(0);
    pass.fill(0);
    onProgress('Los lentes están conectándose a tu Wi-Fi…');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      check();
      await sleep(1200);
      check();
      const value = await step(() => connected!.readCharacteristicForService(SERVICE, TX),
        'El lente dejó de responder al consultar su conexión.', Math.max(1, Math.min(15000, deadline - Date.now())));
      if (!value.value) {
        continue;
      }
      const state = JSON.parse(
        Buffer.from(value.value, 'base64').toString('utf8'),
      );
      if (state.request_id !== id) {
        continue;
      }
      if (state.request_error) {
        throw new Error(
          'Los lentes están ocupados o no pueden guardar la red. Volvé a intentar.',
        );
      }
      if (state.result === 'failed') {
        throw new Error(
          'No pudieron conectarse. Revisá tu Wi-Fi y contraseña. La red anterior se conserva.',
        );
      }
      if (state.result === 'storage_error') {
        throw new Error('No se pudo guardar la red en los lentes.');
      }
      if (state.result === 'saved' && state.connected && state.ssid === ssid) {
        return {
          id: discoveredDevice.id,
          ap: state.ap as string,
          password: credential,
          address: state.ip as string,
        };
      }
    }
    throw new Error('Los lentes no confirmaron la conexión. Volvé a intentar.');
  } finally {
    signal.removeEventListener('abort', cancel);
    await waitForLensOperation(() => connected ? connected.cancelConnection() : ble.cancelDeviceConnection(discoveredDevice.id),
      undefined, 3000, 'No se pudo cerrar Bluetooth.').catch(() => {});
  }
}
