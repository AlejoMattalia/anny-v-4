import RNBluetoothClassic, {
  type BluetoothDevice,
} from 'react-native-bluetooth-classic';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  type AnnyBluetoothDevice,
  type BluetoothEventCleanup,
  type BluetoothPermissionState,
  type BluetoothState,
} from './bluetooth-glasses.types';
import {
  deletePersistentValue,
  readPersistentValue,
  writePersistentValue,
} from './persistent-storage';

const selectedGlassesKey = 'anny-bluetooth-glasses.json';
const GLASSES_NAME_PREFIX = 'CAECUS';
const bluetoothChangeListeners = new Set<() => void>();
let pendingAutomaticConnection: Promise<AnnyBluetoothDevice | null> | null =
  null;

type SavedGlasses = {
  id: string;
  name: string;
};

export function isAnnyGlassesName(name?: string | null) {
  return Boolean(name?.trim().toUpperCase().startsWith(GLASSES_NAME_PREFIX));
}

export async function requestBluetoothPermissions(): Promise<BluetoothPermissionState> {
  if (Platform.OS !== 'android') {
    return 'unsupported';
  }

  if (Number(Platform.Version) >= 31) {
    const permissions = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    const connectGranted =
      permissions[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const scanGranted =
      permissions[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
      PermissionsAndroid.RESULTS.GRANTED;

    return connectGranted && scanGranted ? 'granted' : 'denied';
  }

  const locationPermission = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return locationPermission === PermissionsAndroid.RESULTS.GRANTED
    ? 'granted'
    : 'denied';
}

export async function getBluetoothState(): Promise<BluetoothState> {
  if (Platform.OS !== 'android') {
    return { supported: false, enabled: false };
  }

  const supported = await RNBluetoothClassic.isBluetoothAvailable();
  const enabled = supported
    ? await RNBluetoothClassic.isBluetoothEnabled()
    : false;
  return { supported, enabled };
}

export async function requestBluetoothEnabled() {
  if (Platform.OS !== 'android') {
    return false;
  }
  return RNBluetoothClassic.requestBluetoothEnabled();
}

export function openBluetoothSettings() {
  if (Platform.OS === 'android') {
    RNBluetoothClassic.openBluetoothSettings();
  }
}

export async function getPairedBluetoothDevices() {
  const devices = await RNBluetoothClassic.getBondedDevices();
  return mapDevices(devices);
}

export async function discoverBluetoothDevices() {
  const devices = await RNBluetoothClassic.startDiscovery();
  return mapDevices(devices);
}

export async function cancelBluetoothDiscovery() {
  try {
    await RNBluetoothClassic.cancelDiscovery();
  } catch {
    // Discovery may already be finished.
  }
}

export async function pairBluetoothDevice(deviceId: string) {
  const device = await RNBluetoothClassic.pairDevice(deviceId);
  return mapDevice(device, false);
}

export async function connectBluetoothDevice(device: AnnyBluetoothDevice) {
  await cancelBluetoothDiscovery();
  const connectedDevice = await RNBluetoothClassic.connectToDevice(device.id);
  const connected = await connectedDevice.isConnected();

  if (!connected) {
    throw new Error('No se pudo establecer la conexión serial con el dispositivo.');
  }

  const nextDevice = await mapDevice(connectedDevice, true);
  if (nextDevice.isGlasses) {
    await saveSelectedGlasses(nextDevice);
  }
  notifyBluetoothChanges();
  return nextDevice;
}

export async function disconnectBluetoothDevice(deviceId: string) {
  const selected = await getSelectedGlasses();
  if (selected?.id === deviceId) {
    // Removing the preference first prevents the disconnect event from
    // immediately reconnecting a device that the user disconnected on purpose.
    await deletePersistentValue(selectedGlassesKey);
  }

  const disconnected = await RNBluetoothClassic.disconnectFromDevice(deviceId);
  notifyBluetoothChanges();
  return disconnected;
}

export async function ensureRememberedGlassesConnected() {
  if (pendingAutomaticConnection) {
    return pendingAutomaticConnection;
  }

  pendingAutomaticConnection = connectRememberedGlasses();
  try {
    return await pendingAutomaticConnection;
  } finally {
    pendingAutomaticConnection = null;
  }
}

export async function hasRememberedGlasses() {
  return Boolean(await getSelectedGlasses());
}

export async function getConnectedAnnyGlasses() {
  try {
    const state = await getBluetoothState();
    if (!state.supported || !state.enabled) {
      return null;
    }

    const devices = await getPairedBluetoothDevices();
    const selected = await getSelectedGlasses();
    const selectedDevice = selected
      ? devices.find((device) => device.id === selected.id)
      : null;

    if (selectedDevice?.connected && selectedDevice.isGlasses) {
      return selectedDevice;
    }

    return (
      devices.find((device) => device.isGlasses && device.connected) ?? null
    );
  } catch {
    return null;
  }
}

export async function writeGlassesCommand(deviceId: string, command: string) {
  const normalizedCommand = command.endsWith('\n')
    ? command
    : `${command}\n`;
  return RNBluetoothClassic.writeToDevice(deviceId, normalizedCommand);
}

export function subscribeToBluetoothChanges(
  listener: () => void,
): BluetoothEventCleanup {
  if (Platform.OS !== 'android') {
    return () => undefined;
  }

  bluetoothChangeListeners.add(listener);
  const subscriptions = [
    RNBluetoothClassic.onStateChanged(listener),
    RNBluetoothClassic.onDeviceConnected(listener),
    RNBluetoothClassic.onDeviceDisconnected(listener),
  ];

  return () => {
    bluetoothChangeListeners.delete(listener);
    subscriptions.forEach((subscription) => subscription.remove());
  };
}

export function getBluetoothErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/permission|not allowed|denied/i.test(message)) {
    return 'Anny necesita permiso para buscar y conectar dispositivos Bluetooth.';
  }
  if (/not enabled|disabled|adapter.*off/i.test(message)) {
    return 'Bluetooth está desactivado.';
  }
  if (/timeout|timed out/i.test(message)) {
    return 'La conexión tardó demasiado. Verificá que los lentes estén encendidos y cerca.';
  }
  if (/unable to connect|connect.*fail|socket/i.test(message)) {
    return 'No se pudo conectar. Verificá que los lentes estén encendidos, cerca y vinculados.';
  }

  return message || 'Ocurrió un problema con Bluetooth.';
}

async function mapDevices(devices: BluetoothDevice[]) {
  const mapped = await Promise.all(
    devices.map((device) => mapDevice(device)),
  );
  return mapped.sort((first, second) => {
    if (first.isGlasses !== second.isGlasses) {
      return first.isGlasses ? -1 : 1;
    }
    if (first.connected !== second.connected) {
      return first.connected ? -1 : 1;
    }
    return first.name.localeCompare(second.name);
  });
}

async function mapDevice(
  device: BluetoothDevice,
  knownConnected?: boolean,
): Promise<AnnyBluetoothDevice> {
  const connected =
    knownConnected ?? (await RNBluetoothClassic.isDeviceConnected(device.id));
  const name = device.name?.trim() || 'Dispositivo sin nombre';

  return {
    id: device.id,
    address: device.address || device.id,
    name,
    bonded: Boolean(device.bonded),
    connected,
    isGlasses: isAnnyGlassesName(name),
    rssi: Number.isFinite(Number(device.rssi)) ? Number(device.rssi) : null,
  };
}

async function getSelectedGlasses(): Promise<SavedGlasses | null> {
  try {
    const content = await readPersistentValue(selectedGlassesKey);
    return content ? (JSON.parse(content) as SavedGlasses) : null;
  } catch {
    return null;
  }
}

async function saveSelectedGlasses(device: AnnyBluetoothDevice) {
  const selected: SavedGlasses = {
    id: device.id,
    name: device.name,
  };
  await writePersistentValue(selectedGlassesKey, JSON.stringify(selected));
}

async function connectRememberedGlasses(): Promise<AnnyBluetoothDevice | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  const requiredPermissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const permissionChecks = await Promise.all(
    requiredPermissions.map((permission) =>
      PermissionsAndroid.check(permission),
    ),
  );

  if (permissionChecks.some((granted) => !granted)) {
    return null;
  }

  const state = await getBluetoothState();
  if (!state.supported || !state.enabled) {
    return null;
  }

  const selected = await getSelectedGlasses();
  if (!selected) {
    return null;
  }

  const devices = await getPairedBluetoothDevices();
  const rememberedDevice = devices.find(
    (device) => device.id === selected.id && device.isGlasses,
  );

  if (!rememberedDevice) {
    return null;
  }
  if (rememberedDevice.connected) {
    return rememberedDevice;
  }

  return connectBluetoothDevice(rememberedDevice);
}

function notifyBluetoothChanges() {
  bluetoothChangeListeners.forEach((listener) => listener());
}
