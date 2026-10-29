import { State, type BleManager, type Subscription } from 'react-native-ble-plx';
import { LensDiscoveryError, waitForLensOperation } from './lensOperation';

export async function waitForLensBluetooth(ble: BleManager, signal: AbortSignal) {
  let state = await waitForLensOperation(() => ble.state(), signal, 5000,
    'Bluetooth no respondió. Apagalo, volvé a activarlo y reintentá.');
  // CoreBluetooth starts in Unknown, including while iOS shows its first
  // permission dialog. Wait for that answer before reporting Bluetooth as off.
  if (state === State.Unknown || state === State.Resetting) {
    let subscription: Subscription | undefined;
    try {
      state = await waitForLensOperation(() => new Promise<State>(resolve => {
        subscription = ble.onStateChange(next => {
          if (next !== State.Unknown && next !== State.Resetting) resolve(next);
        }, true);
      }), signal, 60000, 'Bluetooth no terminó de iniciarse. Revisá los permisos de Anny y volvé a intentar.');
    } finally { subscription?.remove(); }
  }
  if (state === State.Unauthorized) {
    throw new LensDiscoveryError('Permití Bluetooth para Anny en Ajustes para encontrar tus lentes.');
  }
  if (state !== State.PoweredOn) {
    throw new LensDiscoveryError('Activá Bluetooth para que Anny encuentre los lentes. El video se transmite por Wi-Fi.');
  }
}
