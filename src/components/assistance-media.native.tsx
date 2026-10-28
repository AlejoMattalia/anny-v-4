import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Camera } from 'expo-camera';
import { NativeModules, PermissionsAndroid, Platform, StyleSheet } from 'react-native';
import { Voximplant, type Call, type Endpoint, type VoxEvent } from 'react-native-voximplant';
import type { AssistanceMediaProps } from './assistance-media.types';
import { parseRemoteCameraMessage, remoteCameraMessage } from '../lib/assistance-remote-camera';

// Voximplant is a singleton. A retry must wait for the previous disconnect.
let previousCleanup: Promise<unknown> = Promise.resolve();
const DIRECT_LENS_VIDEO = 'LENS_VIDEO_WEBRTC_V1';
const HTTP_LENS_VIDEO = 'LENS_VIDEO_HTTP';
function safely(action: () => void) { try { action(); } catch {} }
async function bounded<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tiempo agotado')), ms); })]); }
  finally { clearTimeout(timer); }
}

export default function AssistanceMedia({ ref, role, glasses = false, serverVideo = false, ...callbacks }: AssistanceMediaProps) {
  const handlers = useRef(callbacks);
  useEffect(() => { handlers.current = callbacks; });
  const activeCall = useRef<Call | null>(null);
  const desiredGlasses = useRef(glasses);
  const desiredServerVideo = useRef(serverVideo);
  const syncVideo = useRef<() => void>(() => {});
  useEffect(() => {
    desiredGlasses.current = glasses;
    desiredServerVideo.current = serverVideo;
    syncVideo.current();
  }, [role, glasses, serverVideo]);
  const [localVideo, setLocalVideo] = useState('');
  const [remoteVideo, setRemoteVideo] = useState('');
  useImperativeHandle(ref, () => ({
    sendSource: glasses => safely(() => activeCall.current?.sendMessage(glasses ? 'SHOW_GLASSES' : 'SHOW_CAMERA')),
    sendRemoteCamera: camera => safely(() => activeCall.current?.sendMessage(remoteCameraMessage(camera))),
  }), []);
  useEffect(() => {
    const client = Voximplant.getInstance();
    let stopped = false;
    let failed = false;
    let connected = false;
    let retries = 0;
    let ownsClient = false;
    let sendingVideo = false;
    let nativeSource: boolean | null = null;
    let peerSupportsLensVideo = false;
    let videoUpdate = Promise.resolve();
    let attachedCallId = '';
    let audioRevision = 0;
    const audio = Voximplant.Hardware.AudioDeviceManager.getInstance();
    async function routeAudio(devices?: string[]) {
      const request = ++audioRevision;
      try {
        const available = devices ?? await audio.getAudioDevices();
        if (stopped || failed || !connected || !activeCall.current || request !== audioRevision) return;
        const device = [
          Voximplant.Hardware.AudioDevice.BLUETOOTH,
          Voximplant.Hardware.AudioDevice.WIRED_HEADSET,
          Voximplant.Hardware.AudioDevice.SPEAKER,
          Voximplant.Hardware.AudioDevice.EARPIECE,
        ].find(candidate => available.includes(candidate));
        if (!device) return;
        const active = await audio.getActiveDevice();
        if (stopped || failed || !connected || !activeCall.current || request !== audioRevision) return;
        if (active !== device) audio.selectAudioDevice(device);
      } catch { console.warn('[Assistance] No se pudo actualizar la salida de audio.'); }
    }
    const lensVideo = Platform.OS === 'android' ? NativeModules.LocalLensCallVideo as {
      setSource(callId: string, glasses: boolean): Promise<void>;
      stop(callId: string): Promise<void>;
    } | undefined : undefined;
    // Only the PDV camera is displayed. Sending the tutor camera or sending
    // the PDV camera behind the lens feed wastes bandwidth and an encoder.
    // With the Android bridge, configure its source before enabling the first
    // outgoing track. Later source changes keep that same track and audio.
    const settings = () => ({ video: { sendVideo: role === 'PDV' && !desiredServerVideo.current && !desiredGlasses.current && !lensVideo, receiveVideo: role === 'TUTOR' } });
    syncVideo.current = () => {
      const call = activeCall.current;
      videoUpdate = videoUpdate.then(async () => {
        if (!call || stopped || failed || !connected || activeCall.current !== call) return;
        const direct = !!lensVideo && peerSupportsLensVideo && !desiredServerVideo.current;
        const enabled = role === 'PDV' && !desiredServerVideo.current && (!desiredGlasses.current || direct);
        if (role === 'PDV' && lensVideo && !desiredServerVideo.current && desiredGlasses.current !== nativeSource) {
          const source = desiredGlasses.current;
          await bounded(lensVideo.setSource(call.callId, source));
          nativeSource = source;
        }
        if (enabled !== sendingVideo) {
          await bounded(call.sendVideo(enabled));
          sendingVideo = enabled;
        }
        if (!stopped && !failed) handlers.current.onLensVideoTransport?.(direct);
      }).catch(() => {
        if (stopped || failed) return;
        handlers.current.onLensVideoTransport?.(false);
        if (peerSupportsLensVideo) {
          peerSupportsLensVideo = false;
          safely(() => call?.sendMessage(HTTP_LENS_VIDEO));
          syncVideo.current();
        } else if (role === 'PDV' && !desiredGlasses.current) {
          fail('No se pudo abrir la cámara del celular. Reintentá la conexión de la llamada.');
        } else console.warn('[Assistance] No se pudo cambiar el envío de la cámara.');
      });
    };
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
      attachedCallId = call.callId;
      const valid = () => !stopped && !failed && activeCall.current === call;
      call.getEndpoints().forEach(endpoint);
      listen(call, Voximplant.CallEvents.EndpointAdded, event => { if (valid()) endpoint(event.endpoint); });
      listen(call, Voximplant.CallEvents.LocalVideoStreamAdded, event => { if (valid()) setLocalVideo(event.videoStream.id); });
      listen(call, Voximplant.CallEvents.MessageReceived, event => {
        if (!valid()) return;
        const camera = role === 'TUTOR' ? parseRemoteCameraMessage(event.text) : null;
        if (camera) {
          handlers.current.onRemoteCamera?.(camera);
        } else if (event.text === DIRECT_LENS_VIDEO && lensVideo) {
          peerSupportsLensVideo = true;
          syncVideo.current();
        } else if (event.text === HTTP_LENS_VIDEO) {
          peerSupportsLensVideo = false;
          syncVideo.current();
        } else if (['SHOW_GLASSES', 'SHOW_CAMERA'].includes(event.text)) handlers.current.onSource(event.text === 'SHOW_GLASSES');
      });
      listen(call, Voximplant.CallEvents.Connected, () => {
        if (!valid()) return;
        connected = true; clearTimers();
        if (lensVideo) safely(() => call.sendMessage(DIRECT_LENS_VIDEO));
        syncVideo.current();
        safely(() => call.sendAudio(true));
        const onDevices = (event: { newDeviceList: string[] }) => { void routeAudio(event.newDeviceList); };
        audio.on(Voximplant.Hardware.AudioDeviceEvents.DeviceListChanged, onDevices);
        cleanups.push(() => audio.off(Voximplant.Hardware.AudioDeviceEvents.DeviceListChanged, onDevices));
        void routeAudio();
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
        const options = settings();
        sendingVideo = options.video.sendVideo;
        const call = await client.call(user.split('@')[0], options);
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
        if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
          // Headsets paired in Android still require app permission for call audio.
          const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
          if (!await PermissionsAndroid.check(permission)) await PermissionsAndroid.request(permission);
          if (stopped) return;
        }
        const user = role === 'TUTOR' ? process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_USER : process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_USER;
        const password = role === 'TUTOR' ? process.env.EXPO_PUBLIC_VOXIMPLANT_TUTOR_PASSWORD : process.env.EXPO_PUBLIC_VOXIMPLANT_PDV_PASSWORD;
        if (!user || !password) { fail('Falta configurar el servicio de llamadas de Anny.'); return; }
        ownsClient = true;
        later(() => fail('La llamada no conectó en 30 segundos. Podés reintentar.'), 30000);
        listen(client, Voximplant.ClientEvents.IncomingCall, event => {
          if (stopped || failed || role !== 'PDV' || activeCall.current) { safely(() => event.call.decline()); return; }
          attach(event.call);
          try {
            const options = settings();
            sendingVideo = options.video.sendVideo;
            event.call.answer(options);
          } catch { fail('No se pudo responder la videollamada.'); }
        });
        listen(client, Voximplant.ClientEvents.ConnectionFailed, () => fail('No se pudo conectar con el servicio de llamadas.'));
        listen(client, Voximplant.ClientEvents.ConnectionClosed, () => {
          if (stopped || failed) return;
          if (connected) handlers.current.onEnded(); else fail('Se perdió la conexión con el servicio de llamadas.');
        });
        // SDK 1.42+ requires a node; retain the existing account route used by v3.
        await bounded(client.connect({ node: Voximplant.ConnectionNode.NODE_1 }), 15000);
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
        await videoUpdate;
        if (attachedCallId && lensVideo) {
          try { await bounded(lensVideo.stop(attachedCallId)); } catch {}
        }
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
  return stream && !serverVideo && !(role === 'PDV' && glasses) ? <Voximplant.VideoView style={StyleSheet.absoluteFill} videoStreamId={stream} scaleType={Voximplant.RenderScaleType.SCALE_FIT} accessibilityLabel="Video de la asistencia" /> : null;
}
