import { parseStreamingModeCommand, STREAMING_MODES, type StreamingMode } from './StreamingModes';

export type VoiceAction = 'conversation' | 'home' | 'map' | 'travel' | 'training' | 'contacts' | 'profile' | 'text' | 'image' | 'banknote' |
  'streaming' | 'help' | 'nearby' | 'locations' | 'codes' | 'tutors' | 'radio' | 'audiobook' | 'where' |
  'notifications' | 'more' | 'settings' | 'personal' | 'devices' | 'commands' | 'tutorial' | 'navigate' |
  'cancel_trip' | 'pause_guidance' | 'resume_guidance' | 'repeat' | 'back' | 'exit' | 'start_detection' |
  'stop_detection' | 'wifi' | 'hotspot' | 'next_step' | 'previous_step' | 'board_bus' | 'leave_bus' | 'streaming_mode';
export type VoiceCommand = { name: string; action: VoiceAction; roles: readonly string[]; description: string; scope?: string; mode?: StreamingMode };
const all = ['all'];
const pdv = ['PDV'];
const assisted = ['PDV', 'TUTOR'];
function command(name: string, action: VoiceAction, description: string, roles = all, scope?: string): VoiceCommand {
  return { name, action, description, roles, scope };
}
// All names from v3 AccessibilityContext, glassesContext and the map's local commands.
export const VOICE_COMMANDS: readonly VoiceCommand[] = [
  command('hablar con anny', 'conversation', 'Abre una conversación natural de voz con Anny.'),
  command('conversar', 'conversation', 'Abre una conversación natural de voz con Anny.'),
  ...Object.entries(STREAMING_MODES).map(([mode, value]) => ({ ...command(`modo ${mode}`, 'streaming_mode', `Streaming en modo ${value.label}. ${value.hint}.`), mode: mode as StreamingMode })),
  command('inicio', 'home', 'Vuelve al inicio e intenta reconectar los lentes.'),
  command('mapa', 'map', 'Abre el explorador del mapa.'),
  command('viaje', 'travel', 'Abre la planificación de un viaje.'),
  command('capacitaciones', 'training', 'Abre las capacitaciones.'),
  command('contactos', 'contacts', 'Abre tus contactos.'),
  command('perfil', 'profile', 'Abre tu perfil.'),
  command('texto', 'text', 'Escanea y lee texto en voz alta.', pdv),
  command('imagen', 'image', 'Escanea y describe una imagen.', pdv),
  command('billete', 'banknote', 'Identifica un billete.', pdv),
  command('streaming inteligente', 'streaming', 'Inicia el streaming inteligente.'),
  command('streaming', 'streaming', 'Inicia el streaming inteligente.'),
  command('ayuda', 'help', 'Solicita ayuda a tus tutores o abre las solicitudes recibidas.', assisted),
  command('cercano', 'nearby', 'Busca lugares cercanos a tu ubicación.', pdv),
  command('mis ubicaciones', 'locations', 'Abre tus ubicaciones guardadas.'),
  command('código', 'codes', 'Escanea códigos QR y códigos de barras.'),
  command('tutores', 'tutors', 'Abre tus tutores y personas vinculadas.'),
  command('radio', 'radio', 'Abre Radio Gamba.'),
  command('audiolibro', 'audiobook', 'Abre Audible.'),
  command('dónde estoy', 'where', 'Lee tu dirección actual sin salir de la función que usás.'),
  command('notificaciones', 'notifications', 'Abre las notificaciones.', ['TUTOR', 'Comunidad Accesible']),
  command('más opciones', 'more', 'Abre el menú de opciones.'),
  command('configuración', 'settings', 'Abre la configuración.'),
  command('personal', 'personal', 'Abre la edición de información personal.'),
  command('dispositivos', 'devices', 'Abre la conexión y las redes de los lentes.'),
  command('comandos', 'commands', 'Abre esta lista de comandos.'),
  command('tutorial', 'tutorial', 'Abre el tutorial.'),
  command('navegar hacia', 'navigate', 'Decí el destino y, si querés, a pie, en auto o en colectivo.'),
  command('ir a', 'navigate', 'Por ejemplo: ir a la terminal en colectivo.'),
  command('cancelar viaje', 'cancel_trip', 'Cancela el viaje en curso.', assisted, 'Durante un viaje'),
  command('pausar asistente', 'pause_guidance', 'Silencia las indicaciones del viaje sin detener el recorrido.', assisted),
  command('reanudar asistente', 'resume_guidance', 'Vuelve a activar las indicaciones del viaje.', assisted),
  command('repetir', 'repeat', 'Repite el paso de navegación o vuelve a escanear texto, imagen o billete.', assisted),
  command('volver', 'back', 'Vuelve a la función anterior.'),
  command('salir', 'exit', 'Cierra las funciones activas y vuelve al inicio.'),
  command('iniciar detección', 'start_detection', 'Inicia la detección de objetos con los lentes.', pdv),
  command('parar detección', 'stop_detection', 'Detiene la detección de objetos.', pdv),
  ...['conectar a wifi', 'conectar wifi', 'conectar a wi-fi', 'wifi'].map(name => command(name, 'wifi', 'Conecta los lentes a una red WiFi guardada.', pdv)),
  ...['conectar a hotspot', 'conectar hotspot', 'hotspot'].map(name => command(name, 'hotspot', 'Conecta los lentes a un Hotspot guardado.', pdv)),
  ...['siguiente etapa', 'avanzar etapa'].map(name => command(name, 'next_step', 'Avanza a la siguiente etapa.', all, 'Durante un viaje')),
  ...['etapa anterior', 'retroceder etapa'].map(name => command(name, 'previous_step', 'Vuelve a la etapa anterior.', all, 'Durante un viaje')),
  ...['subí al colectivo', 'subir al colectivo', 'ya subí al colectivo', 'subi al colectivo'].map(name => command(name, 'board_bus', 'Confirma que subiste al colectivo.', all, 'Durante un viaje')),
  ...['bajé del colectivo', 'baje del colectivo'].map(name => command(name, 'leave_bus', 'Confirma que bajaste del colectivo.', all, 'Durante un viaje')),
];
export function normalizeVoiceText(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/wi[\s-]+fi/g, 'wifi').replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function isVoiceCommandAllowed(command: VoiceCommand, roles: readonly string[]) {
  return command.roles.includes('all') || command.roles.some(role => roles.includes(role));
}
export type ParsedVoiceCommand = { command: VoiceCommand; destination?: string; travelMode?: 'walking' | 'driving' | 'transit' };
export function parseVoiceCommand(text: string): ParsedVoiceCommand | null {
  const mode = parseStreamingModeCommand(text);
  if (mode) return { command: VOICE_COMMANDS.find(item => item.mode === mode)! };
  const spoken = text.trim().replace(/^(?:hola\s+)?(?:anny|any|ani|annie)\b[\s,:]*/i, '')
    .replace(/^por favor\s+/i, '').replace(/\s+por favor[.!?]*$/i, '').replace(/[.!?]+$/, '').trim();
  const normalized = normalizeVoiceText(spoken);
  const plain = normalized.replace(/^(?:necesito|quiero abrir|abrir|abre|abri|abrime|escanea|escaneame|escanear|lee|leer)\s+(?:el |la |los |las |un |una )?/, '');
  if (['lugares cercanos', 'lugares cerca', 'comercios cercanos'].includes(plain)) return { command: VOICE_COMMANDS.find(item => item.action === 'nearby')! };
  const direct = VOICE_COMMANDS.find(item => item.action !== 'navigate' && normalizeVoiceText(item.name) === plain);
  if (direct) return { command: direct };
  const navigation = spoken.match(/^(?:quiero\s+)?(navegar hacia|ir a)\s+(.+)$/i);
  if (!navigation) return null;
  let destination = navigation[2].trim();
  let travelMode: ParsedVoiceCommand['travelMode'] = 'walking';
  const suffix = destination.match(/\s+(en auto|en coche|manejando|en transporte p[uú]blico|en colectivo|en autob[uú]s|en bus|en bondi|a pie|caminando)$/i);
  if (suffix) {
    const transport = normalizeVoiceText(suffix[1]);
    travelMode = /auto$|coche|manejando/.test(transport) ? 'driving' : /pie|caminando/.test(transport) ? 'walking' : 'transit';
    destination = destination.slice(0, suffix.index).trim();
  }
  if (!destination) return null;
  return { command: VOICE_COMMANDS.find(item => item.name === navigation[1].toLowerCase())!, destination, travelMode };
}

export type VoiceActionHandler = (request?: ParsedVoiceCommand) => void | Promise<unknown>;
export type VoiceActionHandlers = Partial<Record<VoiceAction, VoiceActionHandler>>;
export class VoiceActionRegistry {
  private handlers = new Map<symbol, VoiceActionHandlers>();
  register(actions: VoiceActionHandlers) {
    const owner = Symbol(); this.handlers.set(owner, actions);
    return () => { this.handlers.delete(owner); };
  }
  async run(action: VoiceAction, request?: ParsedVoiceCommand) {
    const handler = [...this.handlers.values()].reverse().find(actions => actions[action])?.[action];
    if (!handler) return false;
    await handler(request); return true;
  }
}
