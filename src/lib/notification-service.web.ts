import type {
  NotificationPermissionResult,
  NotificationPermissionState,
} from './notification-service.types';

export type {
  NotificationPermissionResult,
  NotificationPermissionState,
} from './notification-service.types';

function getBrowserPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unavailable';
  }

  if (window.Notification.permission === 'granted') return 'granted';
  if (window.Notification.permission === 'denied') return 'denied';
  return 'undetermined';
}

export async function initializeNotifications() {
  // Native notification channels are not needed on web.
}

export async function getNotificationPermission(): Promise<NotificationPermissionResult> {
  const state = getBrowserPermission();
  return {
    canAskAgain: state === 'undetermined',
    state,
  };
}

export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { canAskAgain: false, state: 'unavailable' };
  }

  const permission = await window.Notification.requestPermission();
  return {
    canAskAgain: permission === 'default',
    state: getBrowserPermission(),
  };
}

export async function scheduleNotificationTest() {
  if (getBrowserPermission() !== 'granted') {
    throw new Error('Las notificaciones no están habilitadas.');
  }

  window.setTimeout(() => {
    new window.Notification('Notificación de prueba', {
      body: 'Las alertas de Anny están listas para acompañarte.',
    });
  }, 2000);
}

export async function sendDestinationAlert(destination: string, distance: number) {
  if (getBrowserPermission() !== 'granted') return;

  new window.Notification(destination ? `Próxima parada: ${destination}` : 'Tu destino está cerca', {
    body: `Estás a aproximadamente ${distance} metros. Preparáte para llegar.`,
  });
}
