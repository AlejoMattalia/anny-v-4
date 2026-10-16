import { OneSignal } from 'react-native-onesignal';
import type { NotificationClickEvent, NotificationWillDisplayEvent } from 'react-native-onesignal';
import type { AuthUser } from './auth';

let initialized = false;
let identifiedUser: string | null = null;
function initialize() {
  if (initialized) return;
  const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) throw new Error('Falta configurar OneSignal para recibir solicitudes de ayuda.');
  OneSignal.initialize(appId);
  initialized = true;
}
export function subscribeAssistancePush(listener: (data: unknown) => void) {
  initialize();
  const clicked = (event: NotificationClickEvent) => listener(event.notification.additionalData);
  const foreground = (event: NotificationWillDisplayEvent) => listener(event.getNotification().additionalData);
  OneSignal.Notifications.addEventListener('click', clicked);
  OneSignal.Notifications.addEventListener('foregroundWillDisplay', foreground);
  return () => {
    OneSignal.Notifications.removeEventListener('click', clicked);
    OneSignal.Notifications.removeEventListener('foregroundWillDisplay', foreground);
  };
}
export async function identifyAssistanceUser(user: AuthUser | null) {
  initialize();
  if (!user?._id) {
    // v3's backend targets user_id tags. Remove it before logging out so
    // this installation cannot keep receiving the previous account's help.
    OneSignal.User.removeTags(['user_id', 'first_name', 'last_name', 'email']);
    OneSignal.User.pushSubscription.optOut();
    OneSignal.logout();
    identifiedUser = null;
    return;
  }
  if (identifiedUser && identifiedUser !== user._id) {
    OneSignal.User.removeTags(['user_id', 'first_name', 'last_name', 'email']);
    OneSignal.logout();
  }
  OneSignal.login(user._id);
  OneSignal.User.addTags({ user_id: user._id, first_name: user.name || '', last_name: user.lastName || '', email: user.email || '' });
  OneSignal.User.pushSubscription.optIn();
  identifiedUser = user._id;
}
export async function requestAssistancePushPermission() {
  initialize();
  return OneSignal.Notifications.requestPermission(false);
}
