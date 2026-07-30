export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unavailable';

export type NotificationPermissionResult = {
  canAskAgain: boolean;
  state: NotificationPermissionState;
};
