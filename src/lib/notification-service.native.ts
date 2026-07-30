import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type {
  NotificationPermissionResult,
  NotificationPermissionState,
} from './notification-service.types';

export type {
  NotificationPermissionResult,
  NotificationPermissionState,
} from './notification-service.types';

const TRAVEL_CHANNEL_ID = 'travel-alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function toPermissionState(status: string): NotificationPermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function initializeNotifications() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(TRAVEL_CHANNEL_ID, {
    description: 'Avisos de Anny durante tus recorridos.',
    enableVibrate: true,
    importance: Notifications.AndroidImportance.HIGH,
    name: 'Alertas de viaje',
    showBadge: false,
    vibrationPattern: [0, 250, 180, 250],
  });
}

export async function getNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    await initializeNotifications();
    const permission = await Notifications.getPermissionsAsync();

    return {
      canAskAgain: permission.canAskAgain,
      state: toPermissionState(permission.status),
    };
  } catch {
    return { canAskAgain: false, state: 'unavailable' };
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    await initializeNotifications();
    const permission = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });

    return {
      canAskAgain: permission.canAskAgain,
      state: toPermissionState(permission.status),
    };
  } catch {
    return { canAskAgain: false, state: 'unavailable' };
  }
}

export async function scheduleNotificationTest() {
  await initializeNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'Las alertas de Anny están listas para acompañarte.',
      sound: 'default',
      title: 'Notificación de prueba',
    },
    trigger: {
      channelId: TRAVEL_CHANNEL_ID,
      repeats: false,
      seconds: 2,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
}

export async function sendDestinationAlert(destination: string, distance: number) {
  const permission = await getNotificationPermission();
  if (permission.state !== 'granted') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      body: `Estás a aproximadamente ${distance} metros. Preparáte para llegar.`,
      sound: 'default',
      title: destination ? `Próxima parada: ${destination}` : 'Tu destino está cerca',
    },
    trigger: { channelId: TRAVEL_CHANNEL_ID },
  });
}
