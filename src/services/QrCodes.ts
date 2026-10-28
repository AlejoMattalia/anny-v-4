export type WifiQrNetwork = { ssid: string; password: string; security: string };
export function parseWifiQr(value: string): WifiQrNetwork | null {
  if (!/^WIFI:/i.test(value)) return null;
  const fields: Record<string, string> = {};
  let field = ''; let escaped = false;
  for (const character of `${value.slice(5)};`) {
    if (escaped) { field += character; escaped = false; }
    else if (character === '\\') escaped = true;
    else if (character === ';') {
      const index = field.indexOf(':');
      if (index > 0) fields[field.slice(0, index)] = field.slice(index + 1);
      field = '';
    } else field += character;
  }
  if (!fields.S?.trim()) throw new Error('El código WiFi no incluye el nombre de la red.');
  if (fields.T?.toUpperCase() === 'WPA2-EAP') throw new Error('Esta red requiere un inicio de sesión que los lentes no admiten.');
  return { ssid: fields.S, password: fields.P ?? '', security: fields.T ?? 'WPA' };
}
export function isWebQr(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
