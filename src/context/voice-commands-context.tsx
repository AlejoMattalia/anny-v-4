import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Linking } from 'react-native';
import { router, useIsFocused, usePathname, type Href } from 'expo-router';
import { useAssistance } from './assistance-context';
import { useWifiLens } from './wifi-lens-context';
import { useWifiLensButtons } from './useWifiLensButtons';
import { getExplorationLocation, reverseGeocodeLocation } from '../lib/current-location';
import { getLastSpokenText, listenOnce, setGuidancePaused, speak, stopListening, stopSpeaking } from '../lib/voice';
import { interruptConversation, isTutorCallActive } from '../services/ConversationRuntime';
import { VOICE_COMMANDS, VoiceActionRegistry, isVoiceCommandAllowed, parseVoiceCommand, type VoiceAction, type VoiceActionHandlers } from '../services/VoiceCommands';

const destinations: Partial<Record<VoiceAction, Href>> = {
  conversation: '/conversation' as Href,
  map: '/map-explorer', travel: '/plan-trip', training: '/training', contacts: '/contacts', profile: '/profile',
  nearby: '/nearby-places', locations: '/saved-locations', codes: '/qr-scanner' as Href, tutors: '/tutors',
  notifications: '/notifications', settings: '/settings', devices: '/bluetooth-devices', commands: '/commands' as Href, tutorial: '/onboarding',
};
type VoiceContext = {
  listening: boolean;
  listen: () => Promise<void>;
  cancel: () => void;
  execute: (text: string, options?: { silent?: boolean }) => Promise<boolean>;
  register: (actions: VoiceActionHandlers) => () => void;
};
const Context = createContext<VoiceContext | null>(null);
export function useVoiceCommands() {
  const context = useContext(Context);
  if (!context) throw new Error('Falta el proveedor de comandos de voz.');
  return context;
}
export function useVoiceActions(actions: VoiceActionHandlers, enabled = true) {
  const { register } = useVoiceCommands();
  const focused = useIsFocused();
  const current = useRef(actions);
  useEffect(() => { current.current = actions; });
  const keys = Object.keys(actions).sort().join('|');
  useEffect(() => {
    if (!focused || !enabled) return;
    const handlers: VoiceActionHandlers = {};
    for (const name of keys.split('|').filter(Boolean) as VoiceAction[]) handlers[name] = request => current.current[name]?.(request);
    return register(handlers);
  }, [register, focused, enabled, keys]);
}

export function VoiceCommandsProvider({ children }: PropsWithChildren) {
  const assistance = useAssistance();
  const lens = useWifiLens();
  const pathname = usePathname();
  const [listening, setListening] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const registry = useRef(new VoiceActionRegistry());
  const register = useCallback((actions: VoiceActionHandlers) => registry.current.register(actions), []);
  const current = useRef({ assistance, lens, pathname });
  useEffect(() => { current.current = { assistance, lens, pathname }; });
  const cancel = useCallback(() => {
    const wasListening = busy.current;
    generation.current++; busy.current = false; stopListening(); setListening(false);
    if (wasListening) void stopSpeaking();
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') cancel(); });
    return () => { subscription.remove(); stopListening(); };
  }, [cancel]);
  useEffect(() => () => cancel(), [pathname, assistance.user?._id, cancel]);

  const execute = useCallback(async (text: string, options: { silent?: boolean } = {}) => {
    const say = async (message: string) => { if (!options.silent) await speak(message); };
    const state = current.current;
    const actionGeneration = generation.current;
    if (!state.assistance.user) { await say('Iniciá sesión para usar los comandos de voz.'); return false; }
    const parsed = parseVoiceCommand(text);
    if (!parsed) { await say('No reconocí el comando. Decí comandos para escuchar las opciones.'); return false; }
    const { command } = parsed;
    const roles = state.assistance.user.roles?.flatMap(role => role.name ? [role.name] : []) ?? [];
    if (!isVoiceCommandAllowed(command, roles)) { await say('Tu cuenta no tiene acceso a esta función.'); return false; }
    if (await registry.current.run(command.action, parsed)) return true;
    const route = destinations[command.action];
    if (route) { router.navigate(route); return true; }
    switch (command.action) {
      case 'home':
        router.dismissTo('/home');
        if (state.lens.wifiLensConnection.phase !== 'connected' && state.assistance.role !== 'TUTOR') void state.lens.manager.refresh(true, true);
        break;
      case 'text': case 'image': case 'banknote':
        router.navigate({ pathname: '/visual-scanner', params: { mode: command.action === 'text' ? 'read_text' : command.action === 'image' ? 'describe_scene' : 'identify_currency' } });
        break;
      case 'streaming': case 'streaming_mode':
        router.navigate({ pathname: '/realtime-streaming', params: { streamingMode: command.mode ?? 'viaje', voiceRequest: Date.now().toString() } });
        break;
      case 'help':
        router.navigate('/remote-assistance');
        if (state.assistance.role === 'PDV') await state.assistance.request();
        break;
      case 'where': {
        const position = await getExplorationLocation();
        const address = await reverseGeocodeLocation(position);
        if (actionGeneration === generation.current && current.current.assistance.user?._id === state.assistance.user._id) await say(`Estás en ${address}`);
        break;
      }
      case 'more': router.navigate({ pathname: '/home', params: { menu: '1', voiceRequest: Date.now().toString() } }); break;
      case 'personal': router.navigate({ pathname: '/profile', params: { edit: '1', voiceRequest: Date.now().toString() } }); break;
      case 'radio': await Linking.openURL('https://es.streema.com/radios/LRK1063_Gamba_FM_106.3_FM'); break;
      case 'audiobook': await Linking.openURL('https://www.audible.com/'); break;
      case 'navigate':
        router.push({ pathname: '/plan-trip', params: { destination: parsed.destination!, travelMode: parsed.travelMode!, voiceRequest: Date.now().toString() } }); break;
      case 'pause_guidance': setGuidancePaused(true); await stopSpeaking(); await say('Asistente del viaje pausado.'); break;
      case 'resume_guidance': setGuidancePaused(false); await say('Asistente del viaje reanudado.'); break;
      case 'repeat': await say(getLastSpokenText() || 'Todavía no hay una indicación para repetir.'); break;
      case 'back': if (router.canGoBack()) router.back(); else await say('Ya estás en la pantalla principal.'); break;
      case 'exit':
        state.assistance.cancel(); void state.assistance.endCall();
        setGuidancePaused(false); router.dismissAll(); router.replace('/home'); break;
      case 'wifi': case 'hotspot': {
        const needsExplicitConnect = state.lens.networkPreference === command.action || state.lens.wifiLensConnection.manuallyDisconnected;
        await state.lens.setNetworkPreference(command.action);
        if (needsExplicitConnect) await state.lens.manager.refresh(true, true);
        break;
      }
      case 'start_detection':
        if (state.lens.wifiLensConnection.phase !== 'connected') { await say('Conectá los lentes antes de iniciar la detección.'); return false; }
        router.navigate({ pathname: '/realtime-streaming', params: { detection: '1', voiceRequest: Date.now().toString() } }); break;
      case 'stop_detection': await say('La detección no está activa en esta pantalla.'); return false;
      default: await say('Este comando se usa durante un viaje en curso.'); return false;
    }
    return true;
  }, []);

  const listen = useCallback(async () => {
    if (busy.current || isTutorCallActive() || current.current.assistance.phase === 'calling' || AppState.currentState !== 'active') return;
    if (interruptConversation()) return;
    if (['/assistance-call', '/conversation'].includes(current.current.pathname)) { await speak('El micrófono está en uso en la llamada.'); return; }
    busy.current = true;
    const session = ++generation.current;
    setListening(true);
    try {
      const text = await listenOnce({ prompt: 'Te escucho.', contextualStrings: VOICE_COMMANDS.map(command => command.name) });
      if (session === generation.current) {
        setListening(false); busy.current = false;
        await execute(text);
      }
    } catch (error) {
      if (session === generation.current && error instanceof Error && !/cancelada/i.test(error.message)) await speak(error.message);
    } finally {
      if (session === generation.current) { busy.current = false; setListening(false); }
    }
  }, [execute]);
  useWifiLensButtons(assistance.user && pathname !== '/realtime-streaming' && pathname !== '/assistance-call' && pathname !== '/conversation' ? lens.wifiLensConnection.session : null,
    () => { if (busy.current) cancel(); else void listen(); });
  return <Context.Provider value={{ listening, listen, cancel, execute, register }}>{children}</Context.Provider>;
}
