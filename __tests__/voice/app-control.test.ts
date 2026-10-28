jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
import { AppControlRegistry, appControl, validateAppAction } from '../../src/services/AppControl';
import { ConversationAppService } from '../../src/services/ConversationAppService';
import { getCurrentLocation } from '../../src/lib/current-location';
import { searchLocations, searchNearbyLocations } from '../../src/lib/location-search';
import { getNearbyPlaces } from '../../src/lib/nearby-places';
import { getSavedLocations } from '../../src/lib/saved-locations';
import { setConversationNarrator, setConversationRequested, conversationIsActive, relayConversationSpeech, withoutToolNarration } from '../../src/services/ConversationRuntime';
import * as Contacts from 'expo-contacts/legacy';
import { Linking } from 'react-native';

jest.mock('expo-contacts/legacy', () => ({ requestPermissionsAsync: jest.fn(), getContactsAsync: jest.fn(), Fields: { PhoneNumbers: 'phoneNumbers' }, SortTypes: { FirstName: 'firstName' } }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('../../src/lib/remote-cameras', () => ({ getRemoteCameras: jest.fn(), captureRemoteCamera: jest.fn() }));
jest.mock('../../src/lib/realtime-streaming', () => ({ analyzeRealtimeImage: jest.fn() }));
jest.mock('../../src/lib/notification-service', () => ({}));
jest.mock('../../src/lib/api', () => ({}));
jest.mock('../../src/lib/voice', () => ({ setGuidancePaused: jest.fn() }));
jest.mock('../../src/lib/current-location', () => { const locate = jest.fn(); return { getCurrentLocation: locate, getExplorationLocation: locate }; });
jest.mock('../../src/lib/nearby-places', () => ({ ...jest.requireActual('../../src/lib/nearby-places'), getNearbyPlaces: jest.fn() }));
jest.mock('../../src/lib/location-search', () => ({ ...jest.requireActual('../../src/lib/location-search'), searchLocations: jest.fn(), searchNearbyLocations: jest.fn() }));
jest.mock('../../src/lib/saved-locations', () => ({ getSavedLocations: jest.fn(), saveSavedLocations: jest.fn() }));
jest.mock('../../src/lib/saved-journeys', () => ({ getSavedJourneys: jest.fn(), addSavedJourney: jest.fn() }));
jest.mock('../../src/lib/settings-storage', () => ({ loadSettings: jest.fn(), saveSettings: jest.fn() }));
jest.mock('../../src/lib/profile', () => ({ getProfileUser: jest.fn(), updateProfileUser: jest.fn() }));
jest.mock('../../src/lib/assistance-api', () => ({ addLinkedUser: jest.fn(), listLinkedUsers: jest.fn(), removeLinkedUser: jest.fn() }));

const place = (id: string) => ({ id, name: 'Plaza ' + id, address: 'Córdoba ' + id, latitude: -31.4, longitude: -64.2 });
const cleanups: (() => void)[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentLocation as jest.Mock).mockResolvedValue({ latitude: -31, longitude: -64, accuracy: 12, timestamp: Date.now() });
  (getSavedLocations as jest.Mock).mockResolvedValue([]);
  (searchNearbyLocations as jest.Mock).mockResolvedValue([]);
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); setConversationNarrator(null); setConversationRequested(false); });
function service(navigate = jest.fn()) {
  return { navigate, service: new ConversationAppService({ navigate, user: () => ({ id: 'pdv', role: 'PDV' }), requestAssistance: jest.fn(), answerAssistance: jest.fn() }) };
}
it('defaults to walking and only asks about a genuinely ambiguous named destination', async () => {
  const { navigate, service: control } = service();
  const signal = new AbortController().signal;
  (searchNearbyLocations as jest.Mock).mockResolvedValue([place('1'), place('2')]);
  expect(await control.prepareTrip({ destination: 'plaza' }, signal)).toMatchObject({ needs: 'destinationId', choices: [place('1'), place('2')] });
  expect(navigate).not.toHaveBeenCalled();
  navigate.mockImplementation((_path: string, params: Record<string, string>) => {
    cleanups.push(appControl.register('/start-trip', () => ({ requestId: params.aiRequest, routeReady: true, phase: 'trip_summary', distanceMeters: 1200, durationSeconds: 900 }), () => ({})));
  });
  const result = await control.prepareTrip({ destinationId: '2' }, signal);
  expect(result).toMatchObject({ ok: true, phase: 'trip_summary', distanceMeters: 1200 });
  expect(navigate).toHaveBeenCalledWith('/start-trip', expect.objectContaining({ destName: 'Plaza 2', originLat: '-31', travelMode: 'walking' }));
});
it('preserves a chosen origin while asking which destination the user meant', async () => {
  const { navigate, service: control } = service(); const signal = new AbortController().signal;
  (searchNearbyLocations as jest.Mock).mockImplementation((query: string) => Promise.resolve(query === 'origen' ? [place('o1'), place('o2')] : [place('d1'), place('d2')]));
  expect(await control.prepareTrip({ destination: 'destino', origin: 'origen', mode: 'transit' }, signal)).toMatchObject({ needs: 'originId' });
  expect(await control.prepareTrip({ originId: 'o2' }, signal)).toMatchObject({ needs: 'destinationId' });
  navigate.mockImplementation((_path: string, params: Record<string, string>) => cleanups.push(appControl.register('/start-trip', () => ({ requestId: params.aiRequest, routeReady: true }), () => ({}))));
  expect(await control.prepareTrip({ destinationId: 'd1' }, signal)).toMatchObject({ ok: true });
  expect(navigate).toHaveBeenCalledWith('/start-trip', expect.objectContaining({ originName: 'Plaza o2', destName: 'Plaza d1' }));
});
it('starts only a prepared trip and returns the actual navigating state', async () => {
  const { service: control } = service(); let phase = 'trip_summary';
  const start = jest.fn(() => { phase = 'navigating'; });
  cleanups.push(appControl.register('/start-trip', () => ({ phase, routeReady: true }), () => ({ start_trip: start })));
  expect(await control.run('start_trip', {}, new AbortController().signal)).toMatchObject({ ok: true, phase: 'navigating' });
  expect(start).toHaveBeenCalledTimes(1);
});
it('waits for a real camera and returns its current analysis instead of pretending an open screen is a capture', async () => {
  let screen = '/home'; let ready = false;
  const analyze = jest.fn().mockResolvedValue({ ok: true, text: 'Una puerta roja a la derecha.', capturedAt: 'now' });
  const { service: control, navigate } = service(jest.fn(() => {
    screen = '/visual-scanner';
    cleanups.push(appControl.register(screen, () => ({ cameraReady: ready, mode: 'describe_scene', preferredCamera: 'phone', source: 'phone', analyzing: false }), () => ({ analyze_camera: analyze })));
    setTimeout(() => { ready = true; }, 20);
  }));
  const result = await control.run('analyze_camera', { mode: 'describe_scene', query: '¿De qué color es la puerta?' }, new AbortController().signal);
  expect(result).toMatchObject({ text: 'Una puerta roja a la derecha.' });
  expect(navigate).toHaveBeenCalledWith('/visual-scanner', { mode: 'describe_scene' });
  expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ query: '¿De qué color es la puerta?' }));
});
it('an aborted conversation cannot start a pending screen action', async () => {
  const { service: control, navigate } = service(); const controller = new AbortController(); controller.abort();
  await expect(control.run('analyze_camera', {}, controller.signal)).rejects.toThrow('cancelada');
  expect(navigate).not.toHaveBeenCalled();
});
it('does not open a contact after the conversation ended while contacts were loading', async () => {
  const { service: control } = service(); const controller = new AbortController();
  let finish!: (value: unknown) => void; let started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  (Contacts.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Contacts.getContactsAsync as jest.Mock).mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const result = control.run('call_contact', { id: 'c1' }, controller.signal);
  await loading; controller.abort(); finish({ data: [{ id: 'c1', phoneNumbers: [{ number: '+543510000000' }] }] });
  await expect(result).rejects.toThrow('cancelada');
  expect(Linking.openURL).not.toHaveBeenCalled();
});
it('screen actions are isolated and unregister when their screen closes', async () => {
  const registry = new AppControlRegistry();
  const trip = jest.fn().mockResolvedValue('trip'); const scan = jest.fn().mockResolvedValue('camera');
  const removeTrip = registry.register('/start-trip', () => ({ phase: 'navigating' }), () => ({ next_step: trip }));
  const removeScan = registry.register('/visual-scanner', () => ({ result: 'photo' }), () => ({ analyze_camera: scan }));
  await expect(registry.run('next_step', {})).rejects.toThrow('pantalla');
  await expect(registry.run('analyze_camera', {})).resolves.toBe('camera');
  removeScan(); await expect(registry.run('next_step', {})).resolves.toBe('trip');
  removeTrip(); expect(registry.current().screen).toBeNull();
});
it('enforces real role restrictions and refuses arbitrary action parameters', () => {
  expect(validateAppAction('analyze_camera', { mode: 'read_text' }, ['PDV']).name).toBe('analyze_camera');
  expect(() => validateAppAction('analyze_camera', {}, ['TUTOR'])).toThrow('acceso');
  expect(() => validateAppAction('start_trip', { shell: 'rm -rf' }, ['PDV'])).toThrow('válidos');
  expect(() => validateAppAction('select_route', { index: -1 }, ['PDV'])).toThrow('opción');
});
it('keeps one voice for app guidance and suppresses duplicate speech during a tool result', async () => {
  const narrate = jest.fn().mockResolvedValue(undefined); setConversationNarrator(narrate);
  await expect(relayConversationSpeech('Giramos a la derecha.')).resolves.toBe(true);
  expect(narrate).toHaveBeenCalledWith('Giramos a la derecha.');
  narrate.mockClear();
  await withoutToolNarration(async () => { await relayConversationSpeech('Ruta calculada'); });
  expect(narrate).not.toHaveBeenCalled();
  setConversationNarrator(null); await expect(relayConversationSpeech('Texto')).resolves.toBe(false);
});
it('a pending action from a closed session cannot silence the next conversation', async () => {
  let finish!: () => void;
  setConversationNarrator(jest.fn());
  const old = withoutToolNarration(() => new Promise<void>(resolve => { finish = resolve; }));
  setConversationNarrator(null);
  const next = jest.fn(); setConversationNarrator(next);
  await relayConversationSpeech('Nueva sesión.'); expect(next).toHaveBeenCalledWith('Nueva sesión.');
  finish(); await old;
});
it('keeps autonomous streaming audible while suppressing duplicate guidance from the current tool', async () => {
  const narrator = jest.fn().mockResolvedValue(undefined); setConversationNarrator(narrator);
  await withoutToolNarration(async () => {
    await relayConversationSpeech('Abriendo la pantalla.');
    await relayConversationSpeech('Hay una puerta roja.', { priority: 'stream' });
    await relayConversationSpeech('Girá a la derecha.', { priority: 'guidance' });
  });
  expect(narrator).toHaveBeenCalledTimes(1);
  expect(narrator).toHaveBeenCalledWith('Hay una puerta roja.', { priority: 'stream' });
  expect(narrator).not.toHaveBeenCalledWith('Girá a la derecha.', { priority: 'guidance' });
  setConversationNarrator(null);
});
it.each([['la terminal', 'Terminal de Omnibus Río Cuarto'], ['el super', 'Supermercado cercano'], ['shopping', 'Shopping cercano'], ['kiosko cerca', 'Kiosco cercano'], ['farmacia en Rosario', 'Farmacia Rosario']])('finds %s from GPS without asking for an address or transport', async (query, name) => {
  const gps = { latitude: -33.123, longitude: -64.349, accuracy: 12, timestamp: Date.now() };
  (getCurrentLocation as jest.Mock).mockResolvedValue(gps);
  (searchNearbyLocations as jest.Mock).mockResolvedValue([{ id: '1375008', name, address: 'Río Cuarto, Córdoba', latitude: -33.1142408, longitude: -64.3517898, distanceMeters: 1008 }]);
  const { navigate, service: control } = service(jest.fn((_path, params) => {
    cleanups.push(appControl.register('/start-trip', () => ({ requestId: params.aiRequest, routeReady: true, distanceMeters: 1300, durationSeconds: 960 }), () => ({})));
  }));
  expect(await control.prepareTrip({ destination: query }, new AbortController().signal)).toMatchObject({ ok: true, selectedByProximity: true, mode: 'walking', selectedDestination: { name } });
  expect(searchNearbyLocations).toHaveBeenCalledWith(query, gps);
  expect(navigate).toHaveBeenCalledWith('/start-trip', expect.objectContaining({ originLat: '-33.123', destLat: '-33.1142408', travelMode: 'walking' }));
});
it('keeps one voice during reconnect and resumes only the latest camera result', async () => {
  setConversationRequested(true); setConversationNarrator(null);
  expect(conversationIsActive()).toBe(true);
  expect(await relayConversationSpeech('Resultado anterior.', { priority: 'stream' })).toBe(true);
  expect(await relayConversationSpeech('Resultado actual.', { priority: 'stream' })).toBe(true);
  await relayConversationSpeech('Conectado, iniciando streaming.');
  const narrator = jest.fn().mockResolvedValue(undefined); setConversationNarrator(narrator);
  expect(narrator).toHaveBeenCalledTimes(1);
  expect(narrator).toHaveBeenCalledWith('Resultado actual.', { priority: 'stream' });
});

it('never retries a local empty search as an unbounded trip in another city', async () => {
  const { service: control, navigate } = service();
  expect(await control.prepareTrip({ destination: 'Farmacia La Salud' }, new AbortController().signal)).toMatchObject({ ok: false, choices: [] });
  expect(searchLocations).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});
it('prepares a trip to a verified option offered by search_places without asking for its exact name again', async () => {
  const chosen = { ...place('offered'), name: 'Paseo Ribera Shopping' };
  (searchNearbyLocations as jest.Mock).mockResolvedValue([chosen]);
  const { service: control, navigate } = service(jest.fn((_path, params) => cleanups.push(appControl.register('/start-trip', () => ({ requestId: params.aiRequest, routeReady: true }), () => ({})))));
  await expect(control.run('search_places', { query: 'shopping' }, new AbortController().signal)).resolves.toMatchObject({ places: [chosen] });
  expect(await control.prepareTrip({ destinationId: chosen.id }, new AbortController().signal)).toMatchObject({ ok: true, selectedDestination: chosen });
  expect(navigate).toHaveBeenCalledWith('/start-trip', expect.objectContaining({ destName: chosen.name }));
});
it('asks which shopping the user wants instead of silently picking the closest category match', async () => {
  const { service: control, navigate } = service();
  (searchNearbyLocations as jest.Mock).mockResolvedValue([{ ...place('1'), distanceMeters: 300 }, { ...place('2'), distanceMeters: 1000 }]);
  expect(await control.prepareTrip({ destination: 'shopping' }, new AbortController().signal)).toMatchObject({ ok: false, needs: 'destinationId', choices: expect.any(Array) });
  expect(navigate).not.toHaveBeenCalled();
  expect(await control.run('start_trip', {}, new AbortController().signal)).toMatchObject({ ok: false, needs: 'destinationId' });
});
it('asks for a precise GPS location before looking up or opening a route', async () => {
  const { service: control, navigate } = service();
  (getCurrentLocation as jest.Mock).mockResolvedValue({ latitude: -33.123, longitude: -64.349, accuracy: 900, timestamp: Date.now() });
  await expect(control.prepareTrip({ destination: 'farmacia' }, new AbortController().signal)).rejects.toThrow('ubicación GPS reciente y precisa');
  expect(searchNearbyLocations).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});
it('does not claim a unique closest place when GPS error exceeds the distance difference', async () => {
  const { service: control, navigate } = service();
  (searchNearbyLocations as jest.Mock).mockResolvedValue([{ ...place('1'), distanceMeters: 100 }, { ...place('2'), distanceMeters: 110 }]);
  expect(await control.prepareTrip({ destination: 'farmacia más cercana' }, new AbortController().signal)).toMatchObject({ needs: 'destinationId' });
  expect(navigate).not.toHaveBeenCalled();
});
it('blocks an AI-selected destination ID until another user turn answers the choice question', async () => {
  const { service: control, navigate } = service(jest.fn((_path, params) => cleanups.push(appControl.register('/start-trip', () => ({ requestId: params.aiRequest, routeReady: true }), () => ({})))));
  (searchNearbyLocations as jest.Mock).mockResolvedValue([place('1'), place('2')]);
  control.beginUserTurn();
  expect(await control.prepareTrip({ destination: 'shopping' }, new AbortController().signal)).toMatchObject({ needs: 'destinationId' });
  expect(await control.prepareTrip({ destinationId: '1' }, new AbortController().signal)).toMatchObject({ ok: false, message: expect.stringContaining('Esperá una respuesta nueva') });
  expect(navigate).not.toHaveBeenCalled();
  control.beginUserTurn();
  expect(await control.prepareTrip({ destinationId: '1' }, new AbortController().signal)).toMatchObject({ ok: true });
});
it('does not open a stale route after the person speaks again while its map lookup was pending', async () => {
  const { service: control, navigate } = service(); let finish!: (places: unknown[]) => void;
  (searchNearbyLocations as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  control.beginUserTurn(); const pending = control.prepareTrip({ destination: 'shopping' }, new AbortController().signal);
  while (!finish) await Promise.resolve();
  control.beginUserTurn(); finish([place('1')]);
  expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('volvió a hablar') });
  expect(navigate).not.toHaveBeenCalled();
});

it('answers general nearby questions with the same nearby provider as Explore', async () => {
  const { service: control } = service();
  const places = [{ ...place('shop'), distanceMeters: 80, category: 'shop' }];
  (getNearbyPlaces as jest.Mock).mockResolvedValueOnce(places);
  await expect(control.run('search_places', { query: 'lugares cercanos' }, new AbortController().signal)).resolves.toMatchObject({ ok: true, places });
  expect(getNearbyPlaces).toHaveBeenCalled();
  expect(searchNearbyLocations).not.toHaveBeenCalled();
});
it('reads the places visible on the nearby screen instead of substituting a city search', async () => {
  const { service: control } = service();
  const places = [{ ...place('shown'), distanceMeters: 60, category: 'pharmacy' }];
  cleanups.push(appControl.register('/nearby-places', () => ({ loading: false, places }), () => ({})));
  await expect(control.run('search_places', {}, new AbortController().signal)).resolves.toMatchObject({ places });
  expect(getNearbyPlaces).not.toHaveBeenCalled();
  expect(searchNearbyLocations).not.toHaveBeenCalled();
});
