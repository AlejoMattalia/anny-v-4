import {PermissionsAndroid, Platform} from 'react-native';
import BackgroundService from 'react-native-background-actions';

// Each camera owner holds a lease. Navigating between screens must not stop a
// newly opened stream when the previous screen finishes its cleanup.
const owners = new Set<symbol>();
let operation: Promise<void> = Promise.resolve();

const queue = (work: () => Promise<void>): Promise<void> => {
  const next = operation.catch(() => {}).then(work);
  operation = next.catch(() => {});
  return next;
};

const requestNotificationPermission = async () => {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!await PermissionsAndroid.check(permission)) {
    await PermissionsAndroid.request(permission);
  }
};

export const startGlassesStreamingService = (owner: symbol): Promise<void> => {
  owners.add(owner);
  return queue(async () => {
    if (Platform.OS !== 'android' || BackgroundService.isRunning() || !owners.has(owner)) return;
    try {
      await requestNotificationPermission();
      if (!owners.has(owner)) return;
      await BackgroundService.start(
        // The library releases its HeadlessJS task in stop(). Resolving this
        // promise separately would make it call stop() again during a handoff.
        () => new Promise<void>(() => {}),
        {
          taskName: 'AnnyGlassesStream',
          taskTitle: 'Cámara de lentes Anny activa',
          taskDesc: 'Transmitiendo video desde los lentes',
          taskIcon: {name: 'ic_launcher', type: 'mipmap'},
          color: '#3C1642',
          foregroundServiceType: ['connectedDevice'],
        },
      );
    } catch (error) {
      owners.delete(owner);
      throw error;
    }
  });
};

export const stopGlassesStreamingService = (owner: symbol): Promise<void> => {
  owners.delete(owner);
  return queue(async () => {
    if (owners.size || Platform.OS !== 'android' || !BackgroundService.isRunning()) return;
    await BackgroundService.stop();
  });
};
