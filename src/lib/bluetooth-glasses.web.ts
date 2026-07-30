import {
  type AnnyBluetoothDevice,
  type BluetoothPermissionState,
} from './bluetooth-glasses.types';

export function isAnnyGlassesName(name?: string | null) {
  return Boolean(name?.trim().toUpperCase().startsWith('CAECUS'));
}

export async function requestBluetoothPermissions(): Promise<BluetoothPermissionState> {
  return 'unsupported';
}

export async function getBluetoothState() {
  return { supported: false, enabled: false };
}

export async function requestBluetoothEnabled() {
  return false;
}

export function openBluetoothSettings() {}

export async function getPairedBluetoothDevices(): Promise<AnnyBluetoothDevice[]> {
  return [];
}

export async function discoverBluetoothDevices(): Promise<AnnyBluetoothDevice[]> {
  return [];
}

export async function cancelBluetoothDiscovery() {}

export async function pairBluetoothDevice(
  _deviceId: string,
): Promise<AnnyBluetoothDevice> {
  throw new Error('Bluetooth Classic sólo está disponible en Android.');
}

export async function connectBluetoothDevice(
  _device: AnnyBluetoothDevice,
): Promise<AnnyBluetoothDevice> {
  throw new Error('Bluetooth Classic sólo está disponible en Android.');
}

export async function disconnectBluetoothDevice(_deviceId: string) {
  return false;
}

export async function ensureRememberedGlassesConnected(): Promise<AnnyBluetoothDevice | null> {
  return null;
}

export async function hasRememberedGlasses() {
  return false;
}

export async function getConnectedAnnyGlasses(): Promise<AnnyBluetoothDevice | null> {
  return null;
}

export async function writeGlassesCommand(
  _deviceId: string,
  _command: string,
) {
  return false;
}

export function subscribeToBluetoothChanges(_listener: () => void) {
  return () => undefined;
}

export function getBluetoothErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Bluetooth Classic sólo está disponible en Android.';
}
