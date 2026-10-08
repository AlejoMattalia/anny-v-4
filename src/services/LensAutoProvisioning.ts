import {Buffer} from 'buffer';
import {PermissionsAndroid, Platform} from 'react-native';
import {BleManager, Device, State} from 'react-native-ble-plx';

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
    const granted = await PermissionsAndroid.requestMultiple(permissions);
    if (
      permissions.some(
        permission =>
          granted[permission] !== PermissionsAndroid.RESULTS.GRANTED,
      )
    ) {
      throw new Error(
        'Permití dispositivos cercanos para encontrar tus lentes.',
      );
    }
  }
  check();
  if (!manager) {
    manager = new BleManager();
  }
  const ble = manager;
  if ((await ble.state()) !== State.PoweredOn) {
    throw new Error(
      'Activá Bluetooth para que Anny encuentre los lentes. El video se transmite por Wi-Fi.',
    );
  }
  onProgress('Buscando tus lentes cercanos…');
  const device = await new Promise<Device>((resolve, reject) => {
    let done = false;
    const finish = (found?: Device, error?: Error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      ble.stopDeviceScan();
      signal.removeEventListener('abort', cancel);
      if (found) {
        resolve(found);
      } else {
        reject(
          error || new Error('Encendé los lentes y acercalos al celular.'),
        );
      }
    };
    const cancel = () => finish(undefined, new Error('Conexión cancelada.'));
    const timer = setTimeout(() => finish(), 20000);
    signal.addEventListener('abort', cancel);
    ble.startDeviceScan([SERVICE], null, (error, found) => {
      if (error) {
        finish(
          undefined,
          new Error(
            'No se pudo buscar el lente. Revisá Bluetooth y los permisos.',
          ),
        );
      }
      if (found && (!knownId || found.id === knownId)) {
        finish(found);
      }
    });
  });
  let connected: Device | null = null;
  const cancel = () => {
    void ble.cancelDeviceConnection(device.id).catch(() => {});
  };
  signal.addEventListener('abort', cancel);
  try {
    check();
    onProgress('Conectando con tus lentes…');
    connected = await device.connect({timeout: 15000});
    await connected.discoverAllServicesAndCharacteristics();
    if (Platform.OS === 'android') {
      connected = await connected.requestMTU(247);
    }
    // Encrypted GATT performs automatic system pairing. No device code is shown or entered in Anny.
    const access = await connected.readCharacteristicForService(
      SERVICE,
      ACCESS,
    );
    if (!access.value) {
      throw new Error('Los lentes no respondieron. Volvé a intentar.');
    }
    const credential = Buffer.from(access.value, 'base64').toString('utf8');
    // New lenses advertise typed credentials; old firmware keeps its packet.
    const capability = await connected.readCharacteristicForService(SERVICE, TX);
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
    await connected.writeCharacteristicWithResponseForService(
      SERVICE,
      RX,
      packet.toString('base64'),
    );
    packet.fill(0);
    pass.fill(0);
    onProgress('Los lentes están conectándose a tu Wi-Fi…');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      check();
      await sleep(1200);
      const value = await connected.readCharacteristicForService(SERVICE, TX);
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
          id: device.id,
          ap: state.ap as string,
          password: credential,
          address: state.ip as string,
        };
      }
    }
    throw new Error('Los lentes no confirmaron la conexión. Volvé a intentar.');
  } finally {
    signal.removeEventListener('abort', cancel);
    if (connected) {
      await connected.cancelConnection().catch(() => {});
    }
  }
}
