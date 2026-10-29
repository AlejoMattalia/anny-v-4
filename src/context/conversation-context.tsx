import { router, usePathname, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebView as WebViewInstance, WebViewMessageEvent } from 'react-native-webview';

import { useAssistance } from '@/context/assistance-context';
import { useVoiceCommands } from '@/context/voice-commands-context';
import { useWifiLens } from '@/context/wifi-lens-context';
import { getExplorationLocation, reverseGeocodeLocation } from '@/lib/current-location';
import { playConversationConnecting } from '@/services/ConversationConnectionCue';
import { createVoiceConversation, endVoiceConversation, voiceApiUrl, type ConversationSession } from '@/lib/voice-conversation';
import { requestConversationMicrophone, stopListening, stopSpeaking } from '@/lib/voice';
import { conversationDeadline, releasePreviousVoice } from '@/services/ConversationStartup';
import { loadSettings } from '@/lib/settings-storage';
import { clearAuthSession } from '@/lib/auth';
import { conversationNeedsConfirmation, validateConversationPlan } from '@/services/ConversationActions';
import { appControl, validateAppAction, type AppAction, type AppActionArgs } from '@/services/AppControl';
import { ConversationAppService } from '@/services/ConversationAppService';
import { isTutorCallActive, setConversationNarrator, setConversationRequested, withoutToolNarration } from '@/services/ConversationRuntime';
import { parseVoiceCommand } from '@/services/VoiceCommands';
import { explicitlyEndsConversation } from '@/services/ConversationEnd';

const confirmationMessages: Record<string, string> = {
  help: '¿Querés enviar una solicitud de ayuda a tus tutores?', request_assistance: '¿Querés enviar una solicitud de ayuda a tus tutores?',
  cancel_trip: '¿Querés finalizar el viaje activo?', call_contact: '¿Querés abrir el marcador para llamar al contacto elegido?',
  update_profile: '¿Querés guardar estos cambios en tu perfil?', link_tutor: '¿Querés vincular esta cuenta?', unlink_tutor: '¿Querés desvincular esta cuenta?',
  delete_saved_location: '¿Querés eliminar esta ubicación guardada?', answer_assistance: '¿Querés responder a esta solicitud de asistencia?',
  delete_saved_trip: '¿Querés eliminar este viaje guardado?', logout: '¿Querés cerrar tu sesión de Anny?',
};
const confirmAction = (action: string) => new Promise<boolean>(resolve => Alert.alert(
  action === 'help' || action === 'request_assistance' ? 'Solicitar asistencia' : 'Confirmar acción',
  confirmationMessages[action] || '¿Querés continuar con esta acción?',
  [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) }, { text: 'Continuar', onPress: () => resolve(true) }],
  { cancelable: true, onDismiss: () => resolve(false) },
));

const ConversationContext = createContext<{ running: boolean; start: () => void; stop: () => void }>({ running: false, start: () => {}, stop: () => {} });
export const useConversation = () => useContext(ConversationContext);

const defaultWebViewLoader = () => import('react-native-webview');
export function ConversationProvider({ children, loadWebView = defaultWebViewLoader }: PropsWithChildren<{ loadWebView?: typeof defaultWebViewLoader }>) {
  const assistance = useAssistance();
  const voice = useVoiceCommands();
  const lens = useWifiLens();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [requested, setRequested] = useState(false);
  const expanded = pathname === '/conversation';
  const onTutorCallScreen = pathname === '/assistance-call';
  const web = useRef<WebViewInstance>(null);
  const [WebViewModule, setWebViewModule] = useState<typeof import('react-native-webview') | null>(null);
  const [session, setSession] = useState<ConversationSession | null>(null);
  const sessionRef = useRef<ConversationSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState(false);
  const initialSpeed = useRef(1);
  const [status, setStatus] = useState('Conectando con Anny IA…');
  const pendingNarration = useRef(new Map<string, () => void>());
  const startingNarration = useRef(new Map<string, () => void>());
  const actionController = useRef(new AbortController());
  const active = useRef(false);
  const handledCalls = useRef(new Set<string>());
  const ready = useRef(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryCount = useRef(0);
  const foreground = useRef(AppState.currentState !== 'background');
  const resume = useRef<{ history: { role: string; text: string }[]; muted?: boolean } | null>(null);
  const lastUserTranscript = useRef('');
  const connectionAnnounced = useRef(false);
  const owner = useRef('');
  const current = useRef({ assistance, lens, voice });
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  current.current = { assistance, lens, voice };
  const service = useRef<ConversationAppService | null>(null);
  const createService = () => new ConversationAppService({
    navigate: (path, params) => router.push(params ? { pathname: path, params } as Href : path as Href),
    user: () => ({ id: current.current.assistance.user?._id || '', role: current.current.assistance.role }),
    requestAssistance: () => current.current.assistance.request(),
    answerAssistance: (accepted: boolean) => current.current.assistance.respond(accepted),
  });
  if (!service.current) service.current = createService();

  function inject(method: 'start' | 'result' | 'stop' | 'narrate' | 'interrupt' | 'toggleMute' | 'setContext' | 'setSpeed' | 'setForeground', ...args: unknown[]) {
    web.current?.injectJavaScript(`window.AnnyVoice?.${method}(${args.map(arg => JSON.stringify(arg)).join(',')});true;`);
  }
  function release() {
    clearTimeout(startupTimer.current);
    clearTimeout(retryTimer.current);
    active.current = false;
    setConversationNarrator(null);
    actionController.current.abort();
    for (const done of pendingNarration.current.values()) done();
    pendingNarration.current.clear();
    startingNarration.current.clear();
    inject('stop');
    if (sessionRef.current) void endVoiceConversation(sessionRef.current.ticket);
    sessionRef.current = null;
  }
  function reconnect() {
    release(); setSession(null); setError(''); setStatus('Reconectando con Anny…');
    retryTimer.current = setTimeout(() => setAttempt(value => value + 1), Math.min(30000, 1000 * 2 ** Math.min(retryCount.current++, 5)));
  }

  useEffect(() => {
    if (!requested || !assistance.authLoaded) return;
    if (!assistance.user) { setError('Iniciá sesión para hablar con Anny.'); return; }
    setConversationRequested(true);
    if (owner.current !== (assistance.user._id || '')) { owner.current = assistance.user._id || ''; resume.current = null; lastUserTranscript.current = ''; }
    active.current = true; handledCalls.current.clear(); ready.current = false;
    actionController.current = new AbortController();
    if (!resume.current) service.current = createService();
    const controller = new AbortController();
    setSession(null); setError(''); setEnded(false);
    async function prepare() {
      try {
        setStatus('Preparando el audio de Anny…');
        current.current.voice.cancel(); stopListening();
        await releasePreviousVoice(stopSpeaking, controller.signal);
        if (!active.current || controller.signal.aborted) return;
        const shouldAnnounce = foreground.current && !connectionAnnounced.current;
        if (shouldAnnounce) connectionAnnounced.current = true;
        const connectingCue = shouldAnnounce ? playConversationConnecting(controller.signal) : Promise.resolve();
        setStatus('Revisando el permiso de micrófono…');
        await conversationDeadline(requestConversationMicrophone(), 60000, 'Falta confirmar el permiso de micrófono. Revisá los permisos de Anny e intentá nuevamente.', controller.signal);
        if (!active.current || controller.signal.aborted) return;
        setStatus('Conectando con el servidor de Anny…');
        const [module, next, settings] = await Promise.all([
          conversationDeadline(loadWebView(), 10000, 'No se pudo cargar el componente de audio de Anny.', controller.signal),
          createVoiceConversation(controller.signal),
          conversationDeadline(loadSettings(), 2000, 'No se pudieron leer los ajustes.', controller.signal).catch(() => ({ voiceRate: 1 })),
        ]);
        if (!module.WebView) { void endVoiceConversation(next.ticket); throw new Error('El componente de audio no está disponible en esta instalación.'); }
        initialSpeed.current = Math.min(1.5, Math.max(0.5, settings.voiceRate));
        await connectingCue;
        if (!active.current || controller.signal.aborted) { void endVoiceConversation(next.ticket); return; }
        setStatus('Cargando la conversación de voz…');
        sessionRef.current = next; setWebViewModule(module); setSession(next);
        startupTimer.current = setTimeout(() => {
          if (!active.current) return;
          resume.current ??= { history: [] }; reconnect();
        }, 45000);
      } catch (cause) {
        if (active.current) {
          if (resume.current) reconnect();
          else setError(cause instanceof Error ? cause.message : 'No pudimos iniciar la conversación.');
        }
      }
    }
    void prepare();
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && state !== 'background') return;
      foreground.current = state === 'active';
      inject('setForeground', foreground.current && pathRef.current !== '/assistance-call');
    });
    return () => { controller.abort(); subscription.remove(); release(); };
  // Only replace the session when its owner, focus or explicit retry changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, assistance.authLoaded, assistance.user?._id, attempt]);

  useEffect(() => { if (assistance.authLoaded && !assistance.user && requested) { release(); setConversationRequested(false); setSession(null); setRequested(false); } }, [assistance.authLoaded, assistance.user?._id, requested]);
  useEffect(() => () => setConversationRequested(false), []);
  useEffect(() => { if (active.current) { inject('setContext', pathname); inject('setForeground', foreground.current && pathname !== '/assistance-call'); } }, [pathname]);
  const start = useCallback(() => { if (isTutorCallActive() || current.current.assistance.phase === 'calling') return; connectionAnnounced.current = false; setConversationRequested(true); setRequested(true); setAttempt(value => value + 1); }, []);
  const stop = () => { release(); setConversationRequested(false); resume.current = null; retryCount.current = 0; lastUserTranscript.current = ''; setRequested(false); setSession(null); setEnded(true); if (pathRef.current === '/conversation') { if (router.canGoBack()) router.back(); else router.replace('/home'); } };

  useEffect(() => {
    if (assistance.phase !== 'calling' && pathname !== '/assistance-call') return;
    current.current.voice.cancel(); stopListening(); void stopSpeaking();
    // End the WebRTC session too: muting playback alone leaves a second
    // microphone competing with the tutor call and allows later AI responses.
    // Audio ownership must switch immediately when the call opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistance.phase, onTutorCallScreen]);

  async function runAction(action: AppAction, args: AppActionArgs, roles: string[]) {
    const definition = validateAppAction(action, args, roles);
    if ('confirm' in definition && definition.confirm && !await confirmAction(action)) return { ok: false, message: 'La persona canceló la acción.' };
    if (!active.current) throw new Error('Conversación finalizada.');
    if (action === 'end_conversation') {
      if (!explicitlyEndsConversation(lastUserTranscript.current)) return { ok: false, message: 'La persona no pidió finalizar la conversación. Seguí con su pedido; indicar un destino o abrir una función nunca cierra la voz.' };
      stop(); return { ok: true };
    }
    if (action === 'logout') { stop(); await clearAuthSession(); router.replace('/'); return { ok: true }; }
    const result = await withoutToolNarration(() => service.current!.run(action, args, actionController.current.signal));
    if (action === 'update_setting' && args.setting === 'voiceRate' && typeof args.value === 'number') inject('setSpeed', Math.min(1.5, args.value));
    return result;
  }

  async function onMessage(event: WebViewMessageEvent) {
    if (!active.current || event.nativeEvent.data.length > 20000) return;
    let data;
    try {
      if (new URL(event.nativeEvent.url).origin !== new URL(voiceApiUrl).origin) return;
      data = JSON.parse(event.nativeEvent.data);
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    } catch { return; }
    if (data.type === 'status') {
      setStatus(data.text);
      if (data.connected) setConversationNarrator((text, options) => new Promise<void>(resolve => {
        const id = `notice-${Date.now()}-${Math.random()}`;
        const timeout = setTimeout(() => { pendingNarration.current.delete(id); startingNarration.current.delete(id); resolve(); }, 20000);
        pendingNarration.current.set(id, () => { clearTimeout(timeout); resolve(); });
        if (options?.onStart) startingNarration.current.set(id, options.onStart);
        inject('narrate', id, text, pathRef.current, options?.priority);
      }), () => inject('interrupt'));
      if (data.connected) { clearTimeout(startupTimer.current); retryCount.current = 0; resume.current ??= { history: [] }; }
      return;
    }
    if (data.type === 'narration_started') { startingNarration.current.get(data.id)?.(); startingNarration.current.delete(data.id); return; }
    if (data.type === 'narration_done') { pendingNarration.current.get(data.id)?.(); pendingNarration.current.delete(data.id); startingNarration.current.delete(data.id); return; }
    if (data.type === 'ready') {
      if (!ready.current && sessionRef.current) { ready.current = true; inject('setContext', pathRef.current); inject('start', { ticket: sessionRef.current.ticket, speed: initialSpeed.current, resume: resume.current, foreground: foreground.current && pathRef.current !== '/assistance-call' }); }
      return;
    }
    if (data.type === 'user_turn_started') { service.current?.beginUserTurn?.(); return; }
    if (data.type === 'user_transcript') {
      if (typeof data.text === 'string') {
        lastUserTranscript.current = data.text.slice(0, 2000);
        if (explicitlyEndsConversation(lastUserTranscript.current)) stop();
      }
      return;
    }
    if (data.type === 'reconnect') {
      resume.current = { history: Array.isArray(data.history) ? data.history.filter((item: { role?: string; text?: string }) => item && ['user', 'assistant'].includes(item.role || '') && typeof item.text === 'string').slice(-16).map((item: { role: string; text: string }) => ({ role: item.role, text: item.text.slice(0, 1800) })) : [], muted: Boolean(data.muted) };
      reconnect(); return;
    }
    if (data.type === 'ended') { stop(); return; }
    if (data.type === 'error') { setError(typeof data.message === 'string' ? data.message.slice(0, 300) : 'No pudimos conectar el audio. Revisá el permiso de micrófono e intentá nuevamente.'); release(); setSession(null); return; }
    if (data.type !== 'tool' || typeof data.id !== 'string' || data.id.length > 200 || handledCalls.current.has(data.id)) return;
    handledCalls.current.add(data.id);
    const ownerTicket = sessionRef.current?.ticket;
    try {
      const state = current.current;
      const roles = state.assistance.user?.roles?.flatMap(role => role.name ? [role.name] : []) ?? [];
      const plan = validateConversationPlan(data.plan, roles);
      let result;
      if (plan.name === 'run_app_action') {
        result = await runAction(plan.arguments.action as AppAction, plan.arguments.parameters as AppActionArgs, roles);
      } else if (plan.name === 'get_app_context') {
        result = { ok: true, screen: pathRef.current, function: appControl.current(), name: state.assistance.user?.name, roles,
          lens: { phase: state.lens.wifiLensConnection.phase, network: state.lens.networkPreference },
          assistance: state.assistance.phase, deviceTime: new Date().toISOString() };
      } else if (plan.name === 'get_current_location') {
        const location = await getExplorationLocation();
        const address = await reverseGeocodeLocation(location);
        result = { ok: true, address, latitude: location.latitude, longitude: location.longitude, approximate: location.accuracy == null || location.accuracy > 50, accuracyMeters: location.accuracy, measuredAt: location.timestamp };
      } else {
        if (conversationNeedsConfirmation(plan.arguments.action) && !await confirmAction(plan.arguments.action!)) {
          result = { ok: false, message: 'La persona canceló la acción. No se ejecutó.' };
        } else {
          if (!active.current || ownerTicket !== sessionRef.current?.ticket) return;
          const parsed = parseVoiceCommand(plan.arguments.text!);
          const command = parsed?.command;
          if (command?.action === 'nearby') result = await runAction('search_places', {}, roles);
          else if (command?.action === 'navigate') result = await runAction('prepare_trip', { destination: parsed!.destination, mode: parsed!.travelMode }, roles);
          else if (command && ['text', 'image', 'banknote'].includes(command.action)) result = await runAction('analyze_camera', { mode: command.action === 'text' ? 'read_text' : command.action === 'banknote' ? 'identify_currency' : 'describe_scene' }, roles);
          else if (command && ['streaming', 'streaming_mode'].includes(command.action)) result = await runAction('set_streaming', { enabled: true, mode: command.mode ?? 'viaje' }, roles);
          else {
            const ok = await withoutToolNarration(() => state.voice.execute(plan.arguments.text!, { silent: true }));
            result = { ok, message: ok ? 'El comando fue ejecutado por la app. La conversación sigue disponible.' : 'No se pudo ejecutar el comando en esta pantalla.' };
          }
        }
      }
      if (active.current && ownerTicket === sessionRef.current?.ticket) inject('result', data.id, result);
    } catch (cause) {
      if (active.current && ownerTicket === sessionRef.current?.ticket) inject('result', data.id, { ok: false, message: cause instanceof Error ? cause.message : 'No pudimos completar la acción.' });
    }
  }
  const VoiceWebView = WebViewModule?.WebView;
  return <ConversationContext.Provider value={{ running: requested && !ended, start, stop }}>
    {children}
    {requested && <View pointerEvents="box-none" style={expanded ? styles.expanded : [styles.minimized, { bottom: insets.bottom + 80 }]}>
    <View style={[styles.screen, !expanded && styles.miniScreen]}>
    {!expanded && <Pressable style={styles.miniOrb} accessibilityRole="button"
      accessibilityLabel={`Anny: ${status}. Tocá para abrir la conversación. Mantené presionado para finalizar.`}
      onPress={() => router.navigate('/conversation' as Href)} onLongPress={stop} delayLongPress={800}
      accessibilityActions={[{ name: 'activate', label: 'Abrir conversación' }, { name: 'end', label: 'Finalizar conversación' }]}
      onAccessibilityAction={event => event.nativeEvent.actionName === 'end' ? stop() : router.navigate('/conversation' as Href)} />}
    {session && VoiceWebView && !error ? <VoiceWebView ref={web} source={{ uri: session.url }}
      style={expanded ? styles.web : styles.hiddenWeb} originWhitelist={[new URL(voiceApiUrl).origin]}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === session.url}
      javaScriptEnabled domStorageEnabled={false} mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback
      injectedJavaScript="if(window.AnnyVoice && window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));}true;"
      onLoadEnd={() => web.current?.injectJavaScript("if(window.AnnyVoice && window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));}true;")}
      mediaCapturePermissionGrantType="grantIfSameHostElseDeny" setSupportMultipleWindows={false}
      onMessage={event => { if (sessionRef.current?.ticket === session.ticket) void onMessage(event); }}
      onError={() => { if (sessionRef.current?.ticket === session.ticket) { resume.current ??= { history: [] }; reconnect(); } }}
      onHttpError={() => { if (sessionRef.current?.ticket === session.ticket) { resume.current ??= { history: [] }; reconnect(); } }}
      onRenderProcessGone={() => { if (sessionRef.current?.ticket === session.ticket) { resume.current ??= { history: [] }; reconnect(); } }}
      onContentProcessDidTerminate={() => { if (sessionRef.current?.ticket === session.ticket) { resume.current ??= { history: [] }; reconnect(); } }}
    /> : expanded ? <View style={styles.center}>
      <Pressable accessibilityRole="button" accessibilityLabel={error ? `${error}. Tocá para reintentar.` : status}
        style={[styles.orb, Boolean(error) && styles.errorOrb]}
        onPress={() => { if (error || ended) { release(); start(); } }} onLongPress={stop} delayLongPress={800} />
    </View> : null}
    {expanded && <Pressable accessibilityRole="button" accessibilityLabel="Finalizar llamada con Anny"
      accessibilityHint="Corta la conversación, incluso mientras está conectando."
      style={[styles.endCall, { bottom: insets.bottom + 24 }]} onPress={stop}>
      <MaterialCommunityIcons name="phone-hangup" size={30} color="#FFFFFF" />
    </Pressable>}
  </View></View>}
  </ConversationContext.Provider>;
}
const styles = StyleSheet.create({
  expanded: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 20, backgroundColor: '#17101F' },
  minimized: { position: 'absolute', right: 16, width: 68, height: 68, zIndex: 1000, elevation: 20 },
  screen: { flex: 1, backgroundColor: '#17101F' }, miniScreen: { borderRadius: 34, overflow: 'hidden' },
  miniOrb: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#8957BD', borderWidth: 6, borderColor: '#AA7CD4' },
  hiddenWeb: { width: 1, height: 1, flex: 0, backgroundColor: '#17101F' },
  web: { flex: 1, backgroundColor: '#17101F' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  orb: { width: 160, height: 160, borderRadius: 80, backgroundColor: '#8957BD', borderWidth: 10, borderColor: '#AA7CD4', shadowColor: '#9C59CE', shadowRadius: 28, shadowOpacity: 0.6, elevation: 12 },
  errorOrb: { borderColor: '#C5768E' },
  endCall: { position: 'absolute', alignSelf: 'center', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B32D48', elevation: 4 },
});
