export type Esp32CameraConfig = {
  wifiSsid: string;
  wifiPassword: string;
  cameraId: string;
  deviceSecret: string;
};

export async function provisionEsp32Camera(_config: Esp32CameraConfig) {
  throw new Error('La configuración de la placa está disponible desde la app móvil.');
}
