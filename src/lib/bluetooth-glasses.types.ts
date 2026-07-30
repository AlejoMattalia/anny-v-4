export type BluetoothPermissionState = 'granted' | 'denied' | 'unsupported';

export type AnnyBluetoothDevice = {
  id: string;
  name: string;
  address: string;
  bonded: boolean;
  connected: boolean;
  isGlasses: boolean;
  rssi: number | null;
};

export type BluetoothState = {
  supported: boolean;
  enabled: boolean;
};

export type BluetoothEventCleanup = () => void;
