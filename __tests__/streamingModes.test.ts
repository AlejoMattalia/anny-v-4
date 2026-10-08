import {parseStreamingModeCommand} from '../src/services/StreamingModes';

it.each([
  ['modo facultad', 'facultad'], ['Modo facultás.', 'facultad'],
  ['Anny, activá modo supermercado', 'supermercado'],
  ['hola Any, cambia al modo viaje por favor', 'viaje'],
  ['modo deporte', 'deporte'], ['modo seguro', 'seguro'],
  ['por favor activa el modo seguridad', 'seguro'], ['modo super mercado', 'supermercado'],
])('recognizes %s', (command, mode) => {
  expect(parseStreamingModeCommand(command)).toBe(mode);
});

it.each(['¿Qué hace el modo seguro?', 'No actives modo facultad',
  '¿Dónde está el supermercado?', 'lee el texto modo viaje', 'modo hospital',
  'modo facultad o modo supermercado', ''])('does not switch on %s', command => {
  expect(parseStreamingModeCommand(command)).toBeNull();
});

it.each([
  ['activá el modo seguro', 'seguro'], ['poné modo supermercado', 'supermercado'],
  ['poneme modo facultad', 'facultad'], ['cambiame al modo deporte', 'deporte'],
  ['quiero usar el modo viaje', 'viaje'], ['Anny, pasá a modo seguridad', 'seguro'],
  ['iniciar modo viaje', 'viaje'], ['modo de deportes', 'deporte'],
])('handles natural voice variant %s', (command, mode) => {
  expect(parseStreamingModeCommand(command)).toBe(mode);
});
