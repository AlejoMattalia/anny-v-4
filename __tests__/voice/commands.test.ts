import { VOICE_COMMANDS, VoiceActionRegistry, isVoiceCommandAllowed, parseVoiceCommand } from '../../src/services/VoiceCommands';
import { isWebQr, parseWifiQr } from '../../src/services/QrCodes';
import inventory from '../fixtures/v3-voice-commands.json';

it.each(inventory.names)('retains and recognizes the original v3 command: %s', name => {
  expect(VOICE_COMMANDS.some(command => command.name === name)).toBe(true);
  const text = ['ir a', 'navegar hacia'].includes(name) ? `${name} Terminal de Córdoba` : name;
  expect(parseVoiceCommand(text)?.command.action).toBe(VOICE_COMMANDS.find(command => command.name === name)!.action);
});
it.each([
  ['cancelar viaje', 'cancel_trip'], ['iniciar deteccion', 'start_detection'], ['Hola Anny, conectar a wi-fi', 'wifi'],
  ['ANNY DÓNDE ESTOY', 'where'], ['por favor abrir los contactos', 'contacts'], ['mas opciones', 'more'],
  ['etapa anterior', 'previous_step'], ['ya subi al colectivo', 'board_bus'], ['baje del colectivo', 'leave_bus'],
  ['modo seguridad', 'streaming_mode'],
])('recognizes accents, wake word and full commands without substring collisions: %s', (text, action) => {
  expect(parseVoiceCommand(text)?.command.action).toBe(action);
});
it.each(['no cancelar viaje', 'qué es modo viaje', 'no iniciar detección', 'la imagen del mapa', 'quiero saber qué es un billete'])('does not perform a command just because a question or negation mentions it: %s', text => {
  expect(parseVoiceCommand(text)).toBeNull();
});
it.each([
  ['ir a Hospital Córdoba en auto', 'Hospital Córdoba', 'driving'],
  ['navegar hacia Plaza de la Imagen a pie', 'Plaza de la Imagen', 'walking'],
  ['Anny ir a Terminal en transporte público', 'Terminal', 'transit'],
  ['ir a Museo del Billete en bondi', 'Museo del Billete', 'transit'],
  ['ir a Avenida del Viaje', 'Avenida del Viaje', 'walking'],
])('keeps the destination and chosen transport: %s', (text, destination, travelMode) => {
  expect(parseVoiceCommand(text)).toMatchObject({ command: { action: 'navigate' }, destination, travelMode });
});
it('honors every user role, including a permitted role that is not first', () => {
  const scan = VOICE_COMMANDS.find(command => command.action === 'text')!;
  const notifications = VOICE_COMMANDS.find(command => command.action === 'notifications')!;
  expect(isVoiceCommandAllowed(scan, ['user', 'PDV'])).toBe(true);
  expect(isVoiceCommandAllowed(scan, ['TUTOR'])).toBe(false);
  expect(isVoiceCommandAllowed(notifications, ['Comunidad Accesible'])).toBe(true);
  expect(isVoiceCommandAllowed(notifications, ['PDV'])).toBe(false);
});
it('removes actions on screen exit and restores the prior active owner', async () => {
  const registry = new VoiceActionRegistry();
  const trip = jest.fn(); const scanner = jest.fn();
  const removeTrip = registry.register({ repeat: trip });
  const removeScanner = registry.register({ repeat: scanner });
  await registry.run('repeat'); expect(scanner).toHaveBeenCalledTimes(1); expect(trip).not.toHaveBeenCalled();
  removeScanner(); await registry.run('repeat'); expect(trip).toHaveBeenCalledTimes(1);
  removeTrip(); expect(await registry.run('repeat')).toBe(false);
});
it('reads WiFi codes without breaking escaped semicolons, colons or backslashes', () => {
  expect(parseWifiQr(String.raw`WIFI:T:WPA;S:Casa\;Planta\:2;P:a\\b\;c;;`)).toEqual({ ssid: 'Casa;Planta:2', password: 'a\\b;c', security: 'WPA' });
  expect(parseWifiQr('WIFI:T:nopass;S:Abierta;;')?.password).toBe('');
  expect(() => parseWifiQr('WIFI:T:WPA;P:secret;;')).toThrow('nombre');
  expect(parseWifiQr('123456789')).toBeNull();
  expect(isWebQr('https://example.com')).toBe(true);
  expect(isWebQr('javascript:alert(1)')).toBe(false);
});
