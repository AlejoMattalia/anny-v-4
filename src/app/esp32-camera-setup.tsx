import { Redirect } from 'expo-router';

// Placa ESP32 con código de activación: deshabilitada. Conservamos su implementación.
// export { default } from '@/disabled/esp32-camera-setup';
// Anny usa exclusivamente el flujo Lentes WiFi de anny-app-v3.
export default function DisabledBoardSetup() {
  return <Redirect href="/bluetooth-devices" />;
}
