import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Camera } from 'expo-camera';
import { StyleSheet } from 'react-native';
import { Voximplant, type Call, type Endpoint, type VoxEvent } from 'react-native-voximplant';
import type { AssistanceMediaProps } from './assistance-media.types';

// Voximplant is a singleton. A retry must wait for the previous disconnect.
let previousCleanup: Promise<unknown> = Promise.resolve();
const settings = { video: { sendVideo: true, receiveVideo: true } };
function safely(action: () => void) { try { action(); } catch {} }
async function bounded<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tiempo agotado')), ms); })]); }
  finally { clearTimeout(timer); }
}

export default function AssistanceMedia({ ref, role, ...callbacks }: AssistanceMediaProps) {
  const handlers = useRef(callbacks);
  useEffect(() => { handlers.current = callbacks; });
  const activeCall = useRef<Call | null>(null);
  const [localVideo, setLocalVideo] = useState('');
  const [remoteVideo, setRemoteVideo] = useState('');
  useImperativeHandle(ref, () => ({ sendSource: glasses => safely(() => activeCall.current?.sendMessage(glasses ? 'SHOW_GLASSES' : 'SHOW_CAMERA')) }), []);
  useEffect(() => {
    const client = Voximplant.getInstance();
    let stopped = false;
    let failed = false;
    let connected = false;
    let retries = 0;
    let ownsClient = false;
    const cleanups: (() => void)[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function later(fn: () => void, ms: number) {
      const timer = setTimeout(() => { timers.delete(timer); if (!stopped && !failed) fn(); }, ms);
      timers.add(timer);
    }
    function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
    function fail(message: string) {
      if (stopped || failed) return;
      failed = true; clearTimers();
      const call = activeCall.current; activeCall.current = null;
      safely(() => call?.hangup());
      handlers.current.onError(message);
    }
    function listen(target: typeof client | Call | Endpoint, event: string, listener: (event: VoxEvent) => void) {
      target.on(event, listener); cleanups.push(() => target.off(event, listener));
    }
    function endpoint(endpoint: Endpoint) {
      listen(endpoint, Voximplant.EndpointEvents.RemoteVideoStreamAdded, event => {
        if (!stopped && !failed) setRemoteVideo(event.videoStream.id);
      });
      listen(endpoint, Voximplant.EndpointEvents.RemoteVideoStreamRemoved, () => {
        if (!stopped) setRemoteVideo('');
      });
    }
    function attach(call: Call) {
      activeCall.current = call;
      const valid = () => !stopped && !failed && activeCall.current === call;
      call.getEndpoints().forEach(endpoint);
      listen(call, Voximplant.CallEvents.EndpointAdded, event => { if (valid()) endpoint(event.endpoint); });
      listen(call, Voximplant.CallEvents.LocalVideoStreamAdded, event => { if (valid()) setLocalVideo(event.videoStream.id); });
      listen(call, Voximplant.CallEvents.MessageReceived, event => {
        if (valid() && ['SHOW_GLASSES', 'SHOW_CAMERA'].includes(event.text)) handlers.current.onSource(event.text === 'SHOW_GLASSES');
      });
      listen(call, Voximplant.CallEvents.Connected, () => {
        if (!valid()) return;
        connected = true; clearTimers();
        safely(() => call.sendAudio(true));
        safely(() => Voximplant.Hardware.AudioDeviceManager.getInstance().selectAudioDevice(Voximplant.Hardware.AudioDevice.SPEAKER));
        handlers.current.onConnected();
      });
      listen(call, Voximplant.CallEvents.Disconnected, () => {
        if (valid()) { activeCall.current = null; handlers.current.onEnded(); }
      });
      listen(call, Voximplant.CallEvents.Failed, event => {
        if (!valid()) return;
        if (Number(event.code) === 480 && role === 'TUTOR' && !connected && retries++ < 8) {
          activeCall.current = null;
          later(() => void dial(), 2000);
        } else fail('No se pudo conectar con el otro celular. Revisá que tenga Anny abierta e intentá nuevamente.');
      });
      listen(call, Voximplant.CallEvents.ICETimeout, () => { if (valid()) fail('La conexión de audio y video tardó demasiado. Reintentá la llamada.'); });
    }
    async function dial() {
      try {
        const user = process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_USER;
        if (!user) throw new Error('Falta configurar el usuario de llamadas.');
        const call = await client.call(user.split('@')[0], settings);
        if (stopped || failed) { await call.hangup(); return; }
        attach(call);
      } catch { fail('No se pudo iniciar la llamada. Revisá tu conexión.'); }
    }
    async function start() {
      try {
        await previousCleanup;
        if (stopped) return;
        const camera = await Camera.requestCameraPermissionsAsync();
        if (stopped) return;
        const microphone = await Camera.requestMicrophonePermissionsAsync();
        if (stopped) return;
        if (!camera.granted || !microphone.granted) { fail('Habilitá cámara y micrófono para realizar la videollamada.'); return; }
        const user = role === 'TUTOR' ? process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_USER : process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_USER;
        const password = role === 'TUTOR' ? process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_PASSWORD : process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_PASSWORD;
        if (!user || !password) { fail('Falta configurar el servicio de llamadas de Anny.'); return; }
        ownsClient = true;
        later(() => fail('La llamada no conectó en 30 segundos. Podés reintentar.'), 30000);
        listen(client, Voximplant.ClientEvents.IncomingCall, event => {
          if (stopped || failed || role !== 'PDV' || activeCall.current) { safely(() => event.call.decline()); return; }
          attach(event.call);
          try { event.call.answer(settings); } catch { fail('No se pudo responder la videollamada.'); }
        });
        listen(client, Voximplant.ClientEvents.ConnectionFailed, () => fail('No se pudo conectar con el servicio de llamadas.'));
        listen(client, Voximplant.ClientEvents.ConnectionClosed, () => {
          if (stopped || failed) return;
          if (connected) handlers.current.onEnded(); else fail('Se perdió la conexión con el servicio de llamadas.');
        });
        await bounded(client.connect(), 15000);
        if (stopped || failed) return;
        await bounded(client.login(user, password), 15000);
        if (stopped || failed) return;
        safely(() => Voximplant.Hardware.CameraManager.getInstance().switchCamera('back'));
        if (!stopped && !failed && role === 'TUTOR') later(() => void dial(), 2000);
      } catch { fail('No se pudo conectar con el servicio de llamadas. Revisá tu conexión e intentá nuevamente.'); }
    }
    const startup = start();
    return () => {
      stopped = true; clearTimers(); cleanups.forEach(cleanup => cleanup());
      const call = activeCall.current; activeCall.current = null;
      previousCleanup = (async () => {
        safely(() => call?.hangup());
        async function disconnect() {
          try { if (ownsClient && await bounded(client.getClientState()) !== Voximplant.ClientState.DISCONNECTED) await bounded(client.disconnect()); } catch {}
        }
        await disconnect();
        await startup;
        // connect/login may have completed after unmount.
        await disconnect();
      })();
    };
  }, [role]);
  const stream = role === 'PDV' ? localVideo : remoteVideo;
  return stream ? <Voximplant.VideoView style={StyleSheet.absoluteFill} videoStreamId={stream} scaleType={Voximplant.RenderScaleType.SCALE_FIT} accessibilityLabel="Video de la asistencia" /> : null;
}
