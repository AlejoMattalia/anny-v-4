export const APP_ACTIONS = [
  { name: 'end_conversation', description: 'Apaga el micrófono y termina esta conversación por pedido de la persona.', roles: ['all'] },
  { name: 'pause_guidance', description: 'Pausa las indicaciones automáticas del viaje; la conversación sigue escuchando.', roles: ['all'] },
  { name: 'resume_guidance', description: 'Reanuda las indicaciones automáticas del viaje.', roles: ['all'] },
  { name: 'prepare_trip', description: 'Busca origen y destino reales, calcula la ruta y abre su resumen. No inicia la navegación.', roles: ['all'] },
  { name: 'start_trip', description: 'Inicia el viaje preparado cuando la persona acepta empezar.', roles: ['all'] },
  { name: 'select_route', description: 'Selecciona una alternativa de ruta por su índice de base 1.', roles: ['all'] },
  { name: 'save_trip', description: 'Guarda el viaje preparado con un nombre.', roles: ['all'] },
  { name: 'cancel_trip', description: 'Finaliza el viaje activo.', roles: ['all'], confirm: true },
  { name: 'next_step', description: 'Avanza una etapa del viaje activo.', roles: ['all'] },
  { name: 'previous_step', description: 'Retrocede una etapa del viaje activo.', roles: ['all'] },
  { name: 'board_bus', description: 'Confirma que la persona subió al colectivo en la etapa actual.', roles: ['all'] },
  { name: 'leave_bus', description: 'Confirma que la persona bajó del colectivo en la etapa actual.', roles: ['all'] },
  { name: 'analyze_camera', description: 'Abre el escáner y captura una imagen real: describe_scene, read_text o identify_currency. Puede incluir una pregunta.', roles: ['PDV'] },
  { name: 'set_streaming', description: 'Abre y controla streaming continuo; enabled, mode viaje/facultad/supermercado/deporte/seguro y camera phone/glasses.', roles: ['all'] },
  { name: 'analyze_stream', description: 'Responde una pregunta concreta con una captura actual del streaming.', roles: ['all'] },
  { name: 'switch_camera', description: 'Cambia a camera phone o glasses en el escáner o streaming activo.', roles: ['all'] },
  { name: 'scan_code', description: 'Abre el escáner QR y de barras, o vuelve a escanear.', roles: ['all'] },
  { name: 'get_settings', description: 'Lee los ajustes reales de la aplicación.', roles: ['all'] },
  { name: 'update_setting', description: 'Cambia un ajuste: voiceRate, scanInterval, simulationSpeed, compassActive, destinationAlertsEnabled o notificationDistance.', roles: ['all'] },
  { name: 'list_saved_trips', description: 'Consulta los viajes guardados reales.', roles: ['all'] },
  { name: 'use_saved_trip', description: 'Abre y calcula un viaje guardado por su identificador, sin iniciarlo.', roles: ['all'] },
  { name: 'delete_saved_trip', description: 'Elimina un viaje guardado por id.', roles: ['all'], confirm: true },
  { name: 'list_saved_locations', description: 'Consulta las ubicaciones guardadas reales.', roles: ['all'] },
  { name: 'save_location', description: 'Guarda una ubicación: name y query; sin query usa la ubicación GPS actual.', roles: ['all'] },
  { name: 'delete_saved_location', description: 'Elimina una ubicación guardada por id.', roles: ['all'], confirm: true },
  { name: 'search_places', description: 'Busca lugares por query cerca del GPS actual, sin inventar resultados.', roles: ['all'] },
  { name: 'list_contacts', description: 'Consulta contactos del celular, filtrados por query opcional.', roles: ['all'] },
  { name: 'call_contact', description: 'Abre el marcador para un contacto elegido por id.', roles: ['all'], confirm: true },
  { name: 'get_profile', description: 'Lee los datos básicos de la cuenta actual.', roles: ['all'] },
  { name: 'update_profile', description: 'Actualiza nombre y teléfono del perfil.', roles: ['all'], confirm: true },
  { name: 'list_tutors', description: 'Lista tutores y personas vinculadas.', roles: ['PDV', 'TUTOR'] },
  { name: 'link_tutor', description: 'Vincula una cuenta por email.', roles: ['PDV', 'TUTOR'], confirm: true },
  { name: 'unlink_tutor', description: 'Desvincula una cuenta vinculada por id.', roles: ['PDV', 'TUTOR'], confirm: true },
  { name: 'request_assistance', description: 'Solicita ayuda real a los tutores.', roles: ['PDV'], confirm: true },
  { name: 'answer_assistance', description: 'Acepta o rechaza una solicitud entrante con enabled.', roles: ['TUTOR'], confirm: true },
  { name: 'training_step', description: 'Controla la capacitación activa: index de base 1.', roles: ['all'] },
  { name: 'tutorial_step', description: 'Controla el tutorial activo: index de base 1.', roles: ['all'] },
  { name: 'list_remote_cameras', description: 'Lista las cámaras remotas que pertenecen a la cuenta.', roles: ['all'] },
  { name: 'open_remote_camera', description: 'Abre el video de una cámara remota vinculada por id.', roles: ['all'] },
  { name: 'analyze_remote_camera', description: 'Captura una cámara remota vinculada por id y responde query sobre la imagen actual.', roles: ['all'] },
  { name: 'get_notification_status', description: 'Consulta el permiso real de notificaciones del dispositivo.', roles: ['all'] },
  { name: 'request_notification_permission', description: 'Solicita el permiso de notificaciones al sistema.', roles: ['all'] },
  { name: 'test_notification', description: 'Programa la notificación local de prueba.', roles: ['all'] },
  { name: 'read_terms', description: 'Consulta los términos de uso publicados en el servidor de Anny.', roles: ['all'] },
  { name: 'logout', description: 'Cierra la sesión de la cuenta y termina la conversación.', roles: ['all'], confirm: true },
] as const;
export type AppAction = typeof APP_ACTIONS[number]['name'];
export type AppActionArgs = { query?: string; destination?: string; origin?: string; destinationId?: string; originId?: string; mode?: string; camera?: string; index?: number; enabled?: boolean; id?: string; name?: string; email?: string; phone?: string; setting?: string; value?: number | boolean };
export type AppSnapshot = Record<string, unknown>;
export type AppHandlers = Partial<Record<AppAction, (args: AppActionArgs) => unknown | Promise<unknown>>>;

export function validateAppAction(action: unknown, args: unknown, roles: readonly string[]) {
  const definition = APP_ACTIONS.find(item => item.name === action);
  if (!definition || !(definition.roles as readonly string[]).some(role => role === 'all' || roles.includes(role))) throw new Error('Tu cuenta no tiene acceso a esa acción.');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Parámetros no válidos.');
  const allowed = ['query', 'destination', 'origin', 'destinationId', 'originId', 'mode', 'camera', 'index', 'enabled', 'id', 'name', 'email', 'phone', 'setting', 'value'];
  for (const [key, value] of Object.entries(args)) {
    if (!allowed.includes(key) || (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') || (typeof value === 'string' && value.length > 300) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Parámetros no válidos.');
    if (['index'].includes(key) && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)) throw new Error('Elegí una opción de la lista.');
    if (key === 'enabled' && typeof value !== 'boolean') throw new Error('Indicá si querés activar o desactivar la función.');
    if (!['value', 'enabled', 'index'].includes(key) && typeof value !== 'string') throw new Error('Parámetros no válidos.');
  }
  return definition;
}

export class AppControlRegistry {
  private entries = new Map<symbol, { screen: string; snapshot: () => AppSnapshot; handlers: () => AppHandlers }>();
  register(screen: string, snapshot: () => AppSnapshot, handlers: () => AppHandlers) {
    const owner = Symbol(screen); this.entries.set(owner, { screen, snapshot, handlers });
    return () => { this.entries.delete(owner); };
  }
  current(): AppSnapshot & { screen: string | null; actions: string[] } {
    const entry = [...this.entries.values()].at(-1);
    return entry ? { screen: entry.screen, ...entry.snapshot(), actions: Object.keys(entry.handlers()) } : { screen: null, actions: [] };
  }
  async run(action: AppAction, args: AppActionArgs) {
    const entry = [...this.entries.values()].at(-1);
    const handler = entry?.handlers()[action];
    if (!handler) throw new Error('La función todavía no está lista o requiere otra pantalla.');
    return handler(args);
  }
  async waitFor(predicate: (state: AppSnapshot) => boolean, signal: AbortSignal, timeout = 40000): Promise<AppSnapshot> {
    const deadline = Date.now() + timeout;
    while (!signal.aborted && Date.now() < deadline) {
      const state = this.current();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(signal.aborted ? 'Acción cancelada.' : 'La función no terminó de prepararse. Revisá la conexión o los permisos.');
  }
}
export const appControl = new AppControlRegistry();
