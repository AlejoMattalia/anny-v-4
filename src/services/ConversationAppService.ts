import * as Contacts from 'expo-contacts/legacy';
import { Linking } from 'react-native';
import { searchLocations, searchNearbyLocations, destinationSearchIntent, type LocationSearchResult } from '../lib/location-search';
import { getConversationLocation } from './ConversationLocation';
import { getExplorationLocation } from '../lib/current-location';
import { getNearbyPlaces, isGeneralNearbyQuery } from '../lib/nearby-places';
import { addSavedJourney, getSavedJourneys, deleteSavedJourney } from '../lib/saved-journeys';
import { getRemoteCameras, captureRemoteCamera } from '../lib/remote-cameras';
import { analyzeRealtimeImage } from '../lib/realtime-streaming';
import { getNotificationPermission, requestNotificationPermission, scheduleNotificationTest } from '../lib/notification-service';
import { getTermsOfUse } from '../lib/api';
import { setGuidancePaused } from '../lib/voice';
import { getSavedLocations, saveSavedLocations, type LocationItem } from '../lib/saved-locations';
import { loadSettings, saveSettings } from '../lib/settings-storage';
import { getProfileUser, updateProfileUser } from '../lib/profile';
import { addLinkedUser, listLinkedUsers, removeLinkedUser, type AssistanceRole } from '../lib/assistance-api';
import { appControl, type AppAction, type AppActionArgs } from './AppControl';
import { normalizeVoiceText } from './VoiceCommands';

type Trip = { origin: LocationItem; destination: LocationItem; mode: string };
export type AppServiceDependencies = {
  navigate: (path: string, params?: Record<string, string>) => void;
  user: () => { id: string; role: AssistanceRole | null };
  requestAssistance: () => Promise<unknown>;
  answerAssistance: (accepted: boolean) => Promise<unknown>;
};
export class ConversationAppService {
  private trip: Trip | null = null;
  private draft: AppActionArgs = {};
  private candidates: { origin: LocationSearchResult[]; destination: LocationSearchResult[] } = { origin: [], destination: [] };
  private searchedPlaces = new Map<string, LocationSearchResult>();
  private userTurn = 0;
  private pendingChoiceTurn: number | null = null;
  constructor(private deps: AppServiceDependencies) {}
  beginUserTurn() { this.userTurn++; }

  private async locations(query: string, coords?: { latitude: number; longitude: number }) {
    const saved = (await getSavedLocations()).filter(item => normalizeVoiceText(item.name) === normalizeVoiceText(query));
    if (saved.length) return saved;
    if (coords) {
      const nearby = await searchNearbyLocations(query, coords);
      return nearby.slice(0, 5);
    }
    return searchLocations(query, { limit: 5 });
  }
  async prepareTrip(args: AppActionArgs, signal: AbortSignal) {
    const requestedAtTurn = this.userTurn;
    if (this.userTurn > 0 && this.pendingChoiceTurn === this.userTurn) return { ok: false, needs: 'destinationId', choices: this.candidates.destination.length ? this.candidates.destination : [...this.searchedPlaces.values()], message: 'Esperá una respuesta nueva de la persona: todavía no eligió entre las opciones. No elijas por ella ni vuelvas a preparar el viaje en este mismo turno.' };
    this.trip = null;
    if (!args.destination && args.destinationId && this.searchedPlaces.has(args.destinationId) && this.draft.destinationId !== args.destinationId) {
      args = { ...args, destination: this.searchedPlaces.get(args.destinationId)!.name };
    }
    if (args.destination && args.destination !== this.draft.destination) { this.draft = {}; this.candidates = { origin: [], destination: [] }; this.trip = null; }
    if (args.origin && args.origin !== this.draft.origin) { this.candidates.origin = []; delete this.draft.originId; }
    this.draft = { ...this.draft, ...args };
    const draft = this.draft;
    if (!draft.destination) return { ok: false, needs: 'destination', message: 'Preguntá a dónde quiere ir.' };
    if (!draft.mode) draft.mode = 'walking';
    if (!['walking', 'driving', 'transit'].includes(draft.mode)) throw new Error('Elegí un transporte válido.');
    const gps = await getConversationLocation(signal).catch(error => {
      if (!draft.origin) throw error;
      return null;
    });
    if (signal.aborted) throw new Error('Acción cancelada.');
    let origin: LocationSearchResult;
    if (!draft.origin || /^(mi ubicacion|mi ubicacion actual|mi posicion|gps|current[_ ]location|aca|aqui|actual)$/.test(normalizeVoiceText(draft.origin))) {
      if (!gps) throw new Error('Necesito permiso de ubicación para usar tu posición actual.');
      origin = { id: 'current', name: 'Mi ubicación actual', address: 'Ubicación GPS del celular', ...gps };
    } else {
      if (!draft.originId) this.candidates.origin = await this.locations(draft.origin, gps ?? undefined);
      const options = this.candidates.origin;
      const chosen = draft.originId ? options.find(item => item.id === draft.originId) : options.length === 1 ? options[0] : undefined;
      if (!chosen) return { ok: false, needs: 'originId', message: options.length ? 'Pedí que elija el origen por nombre o dirección.' : 'No encontré ese origen. Pedí otra dirección.', choices: options };
      origin = chosen;
      this.draft.originId = chosen.id;
    }
    const nearby = Boolean(destinationSearchIntent(draft.destination).category) || /\b(cerca|cercano|cercana)\b/.test(normalizeVoiceText(draft.destination));
    const searchCenter = gps ?? origin;
    if (!draft.destinationId) this.candidates.destination = nearby ? await searchNearbyLocations(draft.destination, searchCenter) : await this.locations(draft.destination, searchCenter);
    const options = this.candidates.destination;
    if (requestedAtTurn !== this.userTurn) return { ok: false, message: 'La persona volvió a hablar durante la búsqueda. Escuchá su pedido nuevo antes de elegir o abrir una ruta.' };
    const intent = destinationSearchIntent(draft.destination);
    const explicitlyNearest = /\b(mas cerca|mas cercan[oa]|cerca(?: de mi)?|cercan[oa])\b/.test(normalizeVoiceText(draft.destination));
    const distanceGap = options.length > 1 ? (options[1].distanceMeters ?? 0) - (options[0].distanceMeters ?? 0) : Infinity;
    const certainNearest = nearby && explicitlyNearest && !intent.locality && gps && distanceGap > 2 * gps.accuracy!;
    const destination = draft.destinationId ? options.find(item => item.id === draft.destinationId) || this.searchedPlaces.get(draft.destinationId) : options.length === 1 || certainNearest ? options[0] : undefined;
    if (!destination) {
      if (options.length > 1) this.pendingChoiceTurn = this.userTurn;
      return { ok: false, needs: 'destinationId', message: options.length ? 'Hay varios destinos posibles. Ofrecé hasta tres opciones con nombre y dirección y preguntá cuál prefiere. No elijas ni inicies un viaje por tu cuenta, aunque sean de la misma categoría. Si las distancias son parecidas, el margen de error del GPS no permite asegurar cuál es el más cercano.' : 'Las consultas de mapas todavía no devolvieron opciones verificadas en esa zona. Ofrecé volver a buscar, indicar un barrio o ampliar la zona con su acuerdo. No exijas el nombre exacto ni inventes lugares.', choices: options };
    }
    this.pendingChoiceTurn = null;
    if (signal.aborted) throw new Error('Acción cancelada.');
    this.draft.destinationId = destination.id;
    this.trip = { origin, destination, mode: draft.mode! };
    const id = `ai-trip-${Date.now()}`;
    this.deps.navigate('/start-trip', { originName: origin.name, originAddress: origin.address, originLat: String(origin.latitude), originLng: String(origin.longitude),
      destName: destination.name, destAddress: destination.address, destLat: String(destination.latitude), destLng: String(destination.longitude), travelMode: draft.mode!, aiRequest: id });
    const summary = await appControl.waitFor(state => state.requestId === id && Boolean(state.routeReady || state.routeError), signal);
    return { ok: !summary.routeError, ...summary, selectedDestination: destination, selectedByProximity: nearby, alternatives: options.filter(item => item.id !== destination.id).slice(0, 3), mode: draft.mode,
      message: summary.routeError || 'Ruta preparada. Decí una sola frase con destino, transporte, distancia y duración. Preguntá si quiere empezar. No repitas ni saludes; la conversación sigue abierta.' };
  }

  async run(action: AppAction, args: AppActionArgs, signal: AbortSignal): Promise<unknown> {
    const owner = this.deps.user().id;
    const ensureActive = () => { if (signal.aborted || this.deps.user().id !== owner) throw new Error('Acción cancelada.'); };
    ensureActive();
    switch (action) {
      case 'pause_guidance': setGuidancePaused(true); return { ok: true, guidancePaused: true };
      case 'resume_guidance': setGuidancePaused(false); return { ok: true, guidancePaused: false };
      case 'read_terms': return { ok: true, terms: (await getTermsOfUse()).slice(0, 20000) };
      case 'get_notification_status': return { ok: true, permission: await getNotificationPermission() };
      case 'request_notification_permission': return { ok: true, permission: await requestNotificationPermission() };
      case 'test_notification': await scheduleNotificationTest(); return { ok: true, message: 'Notificación de prueba programada en el dispositivo.' };
      case 'list_remote_cameras': return { ok: true, cameras: await getRemoteCameras() };
      case 'open_remote_camera': case 'analyze_remote_camera': {
        const camera = (await getRemoteCameras()).find(item => item.id === args.id && item.enabled);
        if (!camera) throw new Error('Elegí una cámara habilitada de tu cuenta.');
        if (action === 'open_remote_camera') { ensureActive(); this.deps.navigate('/remote-camera-view', { cameraId: camera.id, name: camera.name }); return { ok: true, camera: camera.name, message: 'Visor de cámara abierto. Consultá su estado para saber si está transmitiendo.' }; }
        const image = await captureRemoteCamera(camera.id);
        if (signal.aborted) throw new Error('Acción cancelada.');
        return { ok: true, text: await analyzeRealtimeImage(image, args.query), camera: camera.name, capturedAt: new Date().toISOString() };
      }
      case 'prepare_trip': return this.prepareTrip(args, signal);
      case 'analyze_camera': {
        const mode = args.mode ?? 'describe_scene';
        if (!['read_text', 'describe_scene', 'identify_currency'].includes(mode)) throw new Error('Modo de escaneo no válido.');
        if (appControl.current().screen !== '/visual-scanner' || appControl.current().mode !== mode) this.deps.navigate('/visual-scanner', { mode });
        await appControl.waitFor(state => state.screen === '/visual-scanner' && state.mode === mode, signal, 15000);
        const camera = args.camera || appControl.current().preferredCamera as string;
        if (camera && appControl.current().source !== camera) await appControl.run('switch_camera', { camera });
        await appControl.waitFor(state => state.cameraReady === true && (!camera || state.source === camera) && state.analyzing === false, signal, 20000);
        ensureActive(); return appControl.run('analyze_camera', args);
      }
      case 'set_streaming': case 'analyze_stream': {
        if (args.mode && !['viaje', 'facultad', 'supermercado', 'deporte', 'seguro'].includes(args.mode)) throw new Error('Modo de streaming no válido.');
        if (appControl.current().screen !== '/realtime-streaming') {
          if (args.enabled === false) return { ok: false, message: 'El streaming no está activo.' };
          this.deps.navigate('/realtime-streaming', { streamingMode: args.mode || 'viaje' });
        }
        await appControl.waitFor(state => state.screen === '/realtime-streaming', signal, 15000);
        if (args.camera) { await appControl.run('switch_camera', args); await appControl.waitFor(state => state.cameraReady === true && state.source === args.camera, signal, 20000); }
        await appControl.waitFor(state => state.cameraReady === true && state.analyzing === false, signal, 30000);
        ensureActive(); return appControl.run(action, args);
      }
      case 'start_trip': {
        if (this.draft.destination && !this.trip) return { ok: false, needs: 'destinationId', message: 'El nuevo viaje todavía no está preparado: falta resolver la ubicación o elegir el destino. Preguntá lo que falta; no inicies una ruta anterior.' };
        ensureActive(); await appControl.run(action, args);
        const state = await appControl.waitFor(state => state.phase === 'navigating', signal, 5000);
        return { ok: true, ...state };
      }
      case 'training_step': case 'tutorial_step':
        if (appControl.current().screen !== (action === 'training_step' ? '/training' : '/onboarding')) this.deps.navigate(action === 'training_step' ? '/training' : '/onboarding');
        await appControl.waitFor(state => state.screen === (action === 'training_step' ? '/training' : '/onboarding') && state.loading !== true, signal, 15000);
        ensureActive(); return appControl.run(action, args);
      case 'scan_code':
        if (appControl.current().screen !== '/qr-scanner') this.deps.navigate('/qr-scanner');
        await appControl.waitFor(state => state.screen === '/qr-scanner', signal, 15000);
        ensureActive(); return appControl.run(action, args);
      case 'get_settings': return { ok: true, settings: await loadSettings() };
      case 'update_setting': {
        const numeric: Record<string, [number, number]> = { voiceRate: [0.5, 1.7], scanInterval: [5, 120], simulationSpeed: [0.2, 2.5], notificationDistance: [50, 2000] };
        const booleans = ['compassActive', 'destinationAlertsEnabled'];
        if (args.setting && Object.hasOwn(numeric, args.setting)) {
          const [min, max] = numeric[args.setting];
          if (typeof args.value !== 'number' || args.value < min || args.value > max) throw new Error(`El valor debe estar entre ${min} y ${max}.`);
        } else if (!booleans.includes(args.setting ?? '') || typeof args.value !== 'boolean') throw new Error('Ajuste o valor no válido.');
        ensureActive(); await saveSettings({ [args.setting!]: args.value });
        const settings = await loadSettings();
        if (settings[args.setting as keyof typeof settings] !== args.value) throw new Error('No se pudo guardar el ajuste.');
        if (appControl.current().screen === '/settings') await appControl.run('update_setting', args);
        return { ok: true, settings };
      }
      case 'list_saved_trips': return { ok: true, trips: (await getSavedJourneys()).slice(0, 30) };
      case 'delete_saved_trip': {
        if (!(await getSavedJourneys()).some(item => item.id === args.id)) throw new Error('Ese viaje no está guardado.');
        ensureActive(); await deleteSavedJourney(args.id!);
        if ((await getSavedJourneys()).some(item => item.id === args.id)) throw new Error('No se pudo eliminar el viaje.');
        return { ok: true };
      }
      case 'use_saved_trip': {
        const trip = (await getSavedJourneys()).find(item => item.id === args.id);
        if (!trip) throw new Error('Elegí un viaje de la lista real.');
        this.trip = { origin: trip.origin, destination: trip.destination, mode: trip.travelMode || 'walking' };
        const id = `ai-trip-${Date.now()}`; ensureActive();
        this.deps.navigate('/start-trip', { originName: trip.origin.name, originAddress: trip.origin.address, originLat: String(trip.origin.latitude), originLng: String(trip.origin.longitude),
          destName: trip.destination.name, destAddress: trip.destination.address, destLat: String(trip.destination.latitude), destLng: String(trip.destination.longitude), travelMode: trip.travelMode || 'walking', aiRequest: id });
        const summary = await appControl.waitFor(state => state.requestId === id && Boolean(state.routeReady || state.routeError), signal);
        return { ok: !summary.routeError, ...summary, message: 'Revisá los datos y preguntá si quiere iniciar. No se inició aún.' };
      }
      case 'save_trip': {
        if (!this.trip) throw new Error('Primero prepará un viaje.');
        ensureActive(); const saved = await addSavedJourney(this.trip.origin, this.trip.destination, args.name, this.trip.mode as 'walking' | 'driving' | 'transit');
        const found = (await getSavedJourneys()).find(item => item.id === saved[0]?.id);
        if (!found) throw new Error('No se pudo guardar el viaje.');
        return { ok: true, trip: found };
      }
      case 'list_saved_locations': return { ok: true, locations: await getSavedLocations() };
      case 'save_location': {
        if (!args.name?.trim()) throw new Error('Pedí un nombre para guardar la ubicación.');
        const gps = await getConversationLocation(signal);
        const matches = args.query ? await this.locations(args.query, gps) : [];
        if (args.query && matches.length !== 1) return { ok: false, message: 'Indicá una dirección más precisa antes de guardar.', choices: matches };
        const item = matches[0] || { ...gps, address: 'Ubicación GPS actual' };
        const location = { id: `ai-${Date.now()}`, name: args.name, address: item.address, latitude: item.latitude, longitude: item.longitude };
        const existing = await getSavedLocations(); ensureActive(); await saveSavedLocations([...existing, location]);
        if (!(await getSavedLocations()).some(item => item.id === location.id)) throw new Error('No se pudo guardar.');
        return { ok: true, location };
      }
      case 'delete_saved_location': {
        const all = await getSavedLocations();
        if (!all.some(item => item.id === args.id)) throw new Error('La ubicación no existe.');
        ensureActive(); await saveSavedLocations(all.filter(item => item.id !== args.id));
        if ((await getSavedLocations()).some(item => item.id === args.id)) throw new Error('No se pudo eliminar.');
        return { ok: true };
      }
      case 'search_places': {
        const gps = await getExplorationLocation();
        ensureActive();
        const general = isGeneralNearbyQuery(args.query);
        const screen = appControl.current();
        const shown = screen.screen === '/nearby-places' && !screen.loading && !screen.error && Array.isArray(screen.places) ? screen.places as LocationSearchResult[] : null;
        const places = general ? shown ?? await getNearbyPlaces(gps) : await searchNearbyLocations(args.query!, gps);
        ensureActive();
        this.searchedPlaces = new Map(places.slice(0, 8).map(place => [place.id, place]));
        if (places.length > 1) this.pendingChoiceTurn = this.userTurn;
        return { ok: true, places: places.slice(0, 8), distanceReference: destinationSearchIntent(args.query || '').locality ? 'centro de la ciudad indicada, no el GPS de la persona' : 'GPS del dispositivo', gpsAccuracyMeters: gps.accuracy, measuredAt: gps.timestamp, message: places.length ? 'Ofrecé hasta tres opciones reales, con nombre, dirección y distancia. Usá la ciudad indicada o, si no indicaron otra, la zona del GPS.' : 'Ofrecé volver a consultar o elegir un barrio de la zona, sin exigir un nombre exacto ni inventar resultados.' };
      }
      case 'list_contacts': case 'call_contact': {
        if (!(await Contacts.requestPermissionsAsync()).granted) throw new Error('Necesito permiso de contactos.');
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers], pageSize: 10000, sort: Contacts.SortTypes.FirstName });
        if (action === 'list_contacts') return { ok: true, total: data.length, contacts: data.filter(item => !args.query || normalizeVoiceText(item.name || '').includes(normalizeVoiceText(args.query))).slice(0, 20).map(item => ({ id: item.id, name: item.name })) };
        const found = data.find(item => item.id === args.id);
        const number = found?.phoneNumbers?.[0]?.number?.replace(/[^+\d]/g, '');
        if (!number || !/^\+?\d{3,20}$/.test(number)) throw new Error('Elegí un contacto de la lista con teléfono válido.');
        ensureActive(); await Linking.openURL('tel:' + number);
        return { ok: true, message: 'Se abrió el marcador del teléfono. La llamada depende de la confirmación del dispositivo.' };
      }
      case 'get_profile': {
        const user = await getProfileUser();
        return { ok: true, profile: user ? { name: user.name, lastName: user.lastName, email: user.email, phone: user.phone } : null };
      }
      case 'update_profile':
        if (!args.name?.trim()) throw new Error('Indicá el nombre que querés guardar.');
        ensureActive(); await updateProfileUser({ name: args.name.trim(), ...(args.phone !== undefined ? { phone: args.phone } : {}) });
        return { ok: true, message: 'Perfil actualizado por el servidor.' };
      case 'list_tutors': return { ok: true, users: (await listLinkedUsers(this.deps.user().id)).map(user => ({ id: user._id, name: user.name, email: user.email })) };
      case 'link_tutor':
        if (!args.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email) || !this.deps.user().role) throw new Error('Indicá un correo válido.');
        ensureActive(); return { ok: await addLinkedUser(this.deps.user().id, this.deps.user().role!, args.email) };
      case 'unlink_tutor':
        if (!(await listLinkedUsers(this.deps.user().id)).some(item => item._id === args.id)) throw new Error('Elegí una persona de la lista vinculada.');
        ensureActive(); await removeLinkedUser(this.deps.user().id, args.id!); return { ok: true };
      case 'request_assistance': { const result = await this.deps.requestAssistance(); return result || { ok: false, message: 'La solicitud no se completó. Consultá el estado de asistencia.' }; }
      case 'answer_assistance':
        if (typeof args.enabled !== 'boolean') throw new Error('Indicá si querés aceptar la solicitud.');
        return (await this.deps.answerAssistance(args.enabled)) || { ok: false, message: 'No se completó la respuesta a la solicitud.' };
      default: ensureActive(); return appControl.run(action, args);
    }
  }
}
