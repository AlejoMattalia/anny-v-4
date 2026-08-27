import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';

import type { Esp32CameraConfig } from './esp32-camera-provisioning';

const BOARD_NAME = 'ANNY-CAM';
const SERVICE_UUID = '9f4e0001-b5a3-f393-e0a9-e50e24dcca9e';
const CONFIG_UUID = '9f4e0002-b5a3-f393-e0a9-e50e24dcca9e';
const ble = new BleManager();

async function requireBluetoothPermission() {
  if (Platform.OS !== 'android') return;
  if (Platform.Version >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    if (Object.values(results).some((result) => result !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error('Anny necesita permiso de Bluetooth para encontrar la placa.');
    }
    return;
  }
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Anny necesita permiso de ubicación para buscar la placa por Bluetooth.');
  }
}

async function waitForBluetooth() {
  if (await ble.state() === State.PoweredOn) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error('Activá Bluetooth para vincular la placa.'));
    }, 15000);
    const subscription = ble.onStateChange((state) => {
      if (state !== State.PoweredOn) return;
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    }, true);
  });
}

async function findBoard(): Promise<Device> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, device?: Device) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ble.stopDeviceScan();
      if (error) reject(error);
      else if (device) resolve(device);
    };
    const timeout = setTimeout(
      () => finish(new Error('No se encontró la placa ANNY-CAM. Verificá que esté encendida y cerca.')),
      20000,
    );
    ble.startDeviceScan([SERVICE_UUID], null, (error, device) => {
      if (error) return finish(new Error(`No se pudo buscar la placa: ${error.message}`));
      if (device && (device.name === BOARD_NAME || device.localName === BOARD_NAME)) finish(undefined, device);
    });
  });
}

export async function provisionEsp32Camera(config: Esp32CameraConfig) {
  await requireBluetoothPermission();
  await waitForBluetooth();
  const found = await findBoard();
  let device: Device | null = null;
  try {
    device = await found.connect({ timeout: 15000 });
    device = await device.requestMTU(512);
    await device.discoverAllServicesAndCharacteristics();
    const payload = Buffer.from(JSON.stringify({
      wifiSsid: config.wifiSsid.trim(),
      wifiPassword: config.wifiPassword,
      cameraId: config.cameraId,
      deviceSecret: config.deviceSecret,
    }), 'utf8').toString('base64');
    await device.writeCharacteristicWithResponseForService(SERVICE_UUID, CONFIG_UUID, payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo enviar la configuración por Bluetooth: ${detail}`);
  } finally {
    if (device) await device.cancelConnection().catch(() => undefined);
  }
}
