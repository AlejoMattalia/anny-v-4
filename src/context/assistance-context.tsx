import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Alert, AppState } from 'react-native';
import { router } from 'expo-router';
import { getAuthSession, subscribeAuthSession, type AuthUser } from '../lib/auth';
import { assistanceRole, finishHelp, getPendingCamera, parseCameraResponse, releaseAssistanceCamera,
  requestTutorHelp, respondToHelp, startAssistanceCall, type AssistanceCall, type HelpRequest } from '../lib/assistance-api';
import { identifyAssistanceUser, subscribeAssistancePush } from '../lib/assistance-push';
import { getCurrentLocation } from '../lib/current-location';
import { speak } from '../lib/voice';

type Phase = 'idle' | 'requesting' | 'waiting' | 'accepted' | 'calling';
function useAssistanceController() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [incoming, setIncoming] = useState<HelpRequest | null>(null);
  const [call, setCall] = useState<AssistanceCall | null>(null);
  const [message, setMessage] = useState('');
  const [pushError, setPushError] = useState('');
  const current = useRef({ user, phase, incoming, call });
  const revision = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  const hydrated = useRef(false);
  const bufferedPush = useRef<unknown[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearWaiting = useCallback(() => {
    revision.current++;
    operation.current?.abort();
    clearTimeout(timeout.current);
  }, []);
  const cancel = useCallback(() => {
    clearWaiting();
    setPhase('idle'); current.current.phase = 'idle';
    setMessage('Solicitud cancelada.');
  }, [clearWaiting]);
  const endCall = useCallback(async (notify = true) => {
    clearWaiting();
    const active = current.current.call;
    current.current.call = null; current.current.incoming = null; current.current.phase = 'idle';
    setCall(null); setIncoming(null); setPhase('idle');
    setMessage('Asistencia finalizada.');
    if (active) {
      await Promise.allSettled([
        releaseAssistanceCamera(active),
        ...(notify ? [finishHelp(current.current.user?._id === active.idPdv ? active.idTutor : active.idPdv)] : []),
      ]);
    }
  }, [clearWaiting]);
  const openCall = useCallback((active: AssistanceCall) => {
    clearWaiting();
    current.current.call = active; current.current.phase = 'calling';
    setCall(active); setPhase('calling'); setMessage('Conectando videollamada…');
    router.push('/assistance-call');
  }, [clearWaiting]);
  const receive = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>;
    const state = current.current;
    const role = assistanceRole(state.user);
    if (!state.user?._id || !role) {
      if (!hydrated.current && bufferedPush.current.length < 10) bufferedPush.current.push(raw);
      return;
    }
    if (data.type === 'help' && role === 'TUTOR' && !state.call) {
      const location = data.currentLocation as HelpRequest['currentLocation'] | undefined;
      if (typeof data._id !== 'string' || !location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
      if (state.incoming) return;
      const request = { _id: data._id, name: typeof data.name === 'string' ? data.name : '', currentLocation: location };
      setIncoming(request); current.current.incoming = request;
      void speak(`${request.name || 'Una persona vinculada'} necesita ayuda.`);
      Alert.alert('Solicitud de asistencia', `${request.name || 'Una persona vinculada'} necesita ayuda.`, [
        { text: 'Ver solicitud', onPress: () => router.push('/remote-assistance') },
        { text: 'Después', style: 'cancel' },
      ]);
    } else if (data.type === 'responseCamera' && role === 'PDV' && ['waiting', 'accepted', 'requesting'].includes(state.phase)) {
      const active = parseCameraResponse(data, state.user._id);
      if (!active || seen.current.has(active.streamCode)) return;
      seen.current.add(active.streamCode);
      openCall(active);
    } else if (['helpAccepted', 'tutor_finded'].includes(String(data.type)) && role === 'PDV' && ['requesting', 'waiting'].includes(state.phase)) {
      setPhase('accepted'); current.current.phase = 'accepted';
      setMessage('Tu tutor aceptó. Esperando que inicie la videollamada.');
      void speak('Tu tutor aceptó la solicitud de ayuda.');
    } else if (['helpIgnored', 'tutor_not_available'].includes(String(data.type)) && role === 'PDV' && state.phase === 'waiting') {
      setMessage('Un tutor no puede responder. Seguimos esperando a tus tutores.');
    } else if (data.type === 'finalizeHelp' && state.call) {
      void endCall(false);
    }
  }, [endCall, openCall]);

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;
    const reload = async () => {
      const attempt = ++authRevision;
      const session = await getAuthSession();
      if (!mounted || attempt !== authRevision) return;
      const next = session?.user ?? null;
      if (current.current.user?._id !== next?._id) {
        if (current.current.user?._id) void endCall();
        else clearWaiting();
        setIncoming(null); current.current.incoming = null; seen.current.clear();
      }
      current.current.user = next; setUser(next);
      setAuthLoaded(true);
      hydrated.current = true;
      bufferedPush.current.splice(0).forEach(receive);
      try { await identifyAssistanceUser(next); if (mounted) setPushError(''); }
      catch (error) { if (mounted) setPushError(error instanceof Error ? error.message : 'No se pudieron activar los avisos.'); }
    };
    void reload();
    const unsubscribe = subscribeAuthSession(() => void reload());
    let stopPush = () => {};
    try { stopPush = subscribeAssistancePush(receive); }
    catch { /* reload reports push configuration errors after loading the account. */ }
    return () => { mounted = false; unsubscribe(); stopPush(); clearWaiting(); };
  }, [clearWaiting, endCall, receive]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' && current.current.user?._id && ['waiting', 'accepted'].includes(current.current.phase)) {
        void getPendingCamera().then(result => receive({ ...result.pending, type: 'responseCamera' })).catch(() => {});
      }
    });
    return () => listener.remove();
  }, [receive]);

  const request = async () => {
    if (busy.current || current.current.phase !== 'idle') return;
    const id = current.current.user?._id;
    if (!id || assistanceRole(current.current.user) !== 'PDV') return;
    busy.current = true;
    clearWaiting();
    const attempt = revision.current;
    const controller = new AbortController(); operation.current = controller;
    setPhase('requesting'); current.current.phase = 'requesting'; setMessage('Buscando tu ubicación…');
    try {
      const location = await new Promise<Awaited<ReturnType<typeof getCurrentLocation>>>((resolve, reject) => {
        const abort = () => reject(new Error('Solicitud cancelada.'));
        controller.signal.addEventListener('abort', abort, { once: true });
        void getCurrentLocation().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
      if (attempt !== revision.current) return;
      await requestTutorHelp(id, { latitude: location.latitude, longitude: location.longitude }, controller.signal);
      if (attempt !== revision.current) return;
      if (current.current.phase === 'requesting') {
        setPhase('waiting'); current.current.phase = 'waiting'; setMessage('Buscando un tutor…');
        void speak('Buscando un tutor.');
      }
      const poll = async () => {
        try { const result = await getPendingCamera(controller.signal); if (attempt === revision.current) receive({ ...result.pending, type: 'responseCamera' }); } catch {}
        if (attempt === revision.current) timeout.current = setTimeout(() => void poll(), 2000);
      };
      const deadline = setTimeout(() => {
        if (attempt !== revision.current) return;
        cancel(); setMessage('Ningún tutor inició la llamada. Podés volver a solicitar ayuda.');
        void speak('Ningún tutor pudo iniciar la llamada.');
      }, 65000);
      controller.signal.addEventListener('abort', () => clearTimeout(deadline), { once: true });
      void poll();
    } catch (error) {
      if (attempt === revision.current) {
        cancel(); setMessage(error instanceof Error ? error.message : 'No se pudo solicitar ayuda.');
      }
    } finally { busy.current = false; }
  };
  const respond = async (accepted: boolean) => {
    const state = current.current;
    if (busy.current || !state.incoming || !state.user?._id || assistanceRole(state.user) !== 'TUTOR') return;
    busy.current = true;
    const attempt = revision.current;
    try {
      await respondToHelp(state.incoming._id, state.user._id, accepted);
      if (attempt !== revision.current) return;
      if (accepted) { setPhase('accepted'); current.current.phase = 'accepted'; setMessage('Solicitud aceptada. Podés ver la ubicación e iniciar la videollamada.'); }
      else { setIncoming(null); current.current.incoming = null; setPhase('idle'); current.current.phase = 'idle'; }
    } finally { busy.current = false; }
  };
  const startCall = async () => {
    const state = current.current;
    if (busy.current || state.phase !== 'accepted' || !state.incoming || !state.user?._id || assistanceRole(state.user) !== 'TUTOR') return;
    busy.current = true;
    const attempt = revision.current;
    try {
      const active = await startAssistanceCall(state.incoming._id, state.user._id);
      if (attempt !== revision.current) { await releaseAssistanceCamera(active).catch(() => {}); return; }
      openCall(active);
    } finally { busy.current = false; }
  };
  return { user, authLoaded, role: assistanceRole(user), phase, incoming, call, message, pushError, request, cancel, respond, startCall, endCall };
}
const AssistanceContext = createContext<ReturnType<typeof useAssistanceController> | null>(null);
export function AssistanceProvider({ children }: PropsWithChildren) {
  return <AssistanceContext.Provider value={useAssistanceController()}>{children}</AssistanceContext.Provider>;
}
export function useAssistance() {
  const value = useContext(AssistanceContext);
  if (!value) throw new Error('Falta AssistanceProvider.');
  return value;
}
