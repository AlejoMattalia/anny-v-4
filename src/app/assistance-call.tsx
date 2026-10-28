import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAssistance } from '../context/assistance-context';
import { useWifiLens } from '../context/wifi-lens-context';
import { useAssistanceCamera } from '../context/use-assistance-camera';
import AssistanceMedia from '../components/assistance-media';
import type { AssistanceMediaHandle } from '../components/assistance-media.types';
import WifiLensCamera, { type WifiLensCameraHandle } from '../components/WifiLensCamera';
import RemoteCameraStream from '../components/remote-camera-stream';
import { assistanceVideoUrl, sendAssistanceFrame } from '../lib/assistance-api';
import { startAssistanceFramePump } from '../lib/assistance-frame-pump';
import { speak } from '../lib/voice';

export default function AssistanceCallScreen() {
  const { call, role, endCall } = useAssistance();
  const { wifiLensConnection } = useWifiLens();
  const media = useRef<AssistanceMediaHandle>(null);
  const camera = useRef<WifiLensCameraHandle>(null);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [videoError, setVideoError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [directLensVideo, setDirectLensVideo] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [playbackRequestedAt, setPlaybackRequestedAt] = useState(() => Date.now());
  const { glasses, remoteCamera, choosing, notice, selectSource: chooseSource, receiveRemoteCamera } = useAssistanceCamera({
    role, callId: call?.streamCode, localAvailable: wifiLensConnection.phase === 'connected', foreground,
  });
  const ending = useRef(false);
  const mounted = useRef<symbol | null>(null);
  const usingGlasses = !!remoteCamera || (glasses && (role === 'TUTOR' || wifiLensConnection.phase === 'connected'));

  // Native back, gestures, explicit hangup and remote hangup share cleanup.
  useEffect(() => {
    if (!call && !ending.current) {
      ending.current = true;
      router.replace('/remote-assistance');
    }
  }, [call]);
  useEffect(() => {
    const mount = Symbol('assistance-screen');
    mounted.current = mount;
    return () => {
      // A development StrictMode effect replay is not a user leaving the call.
      queueMicrotask(() => { if (mounted.current === mount) void endCall(); });
    };
  }, [endCall]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setPlaybackRequestedAt(Date.now());
      setForeground(state === 'active');
    });
    return () => sub.remove();
  }, []);
  function selectSource(next: boolean, notify = true) {
    setVideoError('');
    void chooseSource(next);
    // The PDV announces the resolved source, after obtaining playback access.
    if (role === 'TUTOR' && notify) media.current?.sendSource(next);
  }
  useEffect(() => {
    if (role !== 'PDV' || !connected || choosing) return;
    if (remoteCamera) media.current?.sendRemoteCamera(remoteCamera);
    else media.current?.sendSource(usingGlasses);
  }, [connected, role, usingGlasses, remoteCamera, choosing]);
  useEffect(() => {
    // The tutor cannot mint access to the PDV's camera with its own account.
    if (role === 'TUTOR' && connected && foreground && remoteCamera && remoteCamera.expiresAt <= Date.now()) {
      media.current?.sendSource(true);
    }
  }, [role, connected, foreground, remoteCamera, playbackRequestedAt]);
  useEffect(() => {
    if (!call || role !== 'PDV' || !connected || !usingGlasses || !ready || !foreground || directLensVideo || remoteCamera || choosing) return;
    return startAssistanceFramePump({
      capture: async () => camera.current?.capture(),
      send: (frame, signal) => sendAssistanceFrame(call, frame, signal),
      onFailure: () => {
        void chooseSource(false); media.current?.sendSource(false);
        setVideoError('No se pudo compartir el video de los lentes. Usando cámara del celular.');
      },
    });
  }, [call, role, connected, usingGlasses, ready, foreground, directLensVideo, remoteCamera, choosing, chooseSource]);

  if (!call || !role) return null;
  return <SafeAreaView style={styles.screen}>
    <Text style={styles.title}>Videollamada de asistencia</Text>
    <View style={styles.video}>
      {Platform.OS !== 'web' && !error && <AssistanceMedia key={attempt} ref={media} role={role} glasses={usingGlasses} serverVideo={!!remoteCamera}
        onConnected={() => { setConnected(true); void speak('Videollamada iniciada.'); }}
        onEnded={() => void endCall(false)} onSource={next => selectSource(next, false)}
        onRemoteCamera={camera => { receiveRemoteCamera(camera); setVideoError(''); }}
        onLensVideoTransport={setDirectLensVideo}
        onError={message => { setError(message); setConnected(false); }} />}
      {remoteCamera && remoteCamera.expiresAt > playbackRequestedAt && connected && foreground && !error && <View style={StyleSheet.absoluteFill}>
        <RemoteCameraStream key={`${remoteCamera.cameraId}:${feedAttempt}`} streamUrl={remoteCamera.streamUrl}
          onError={() => setVideoError('No se pudo cargar el lente del servidor. Podés reintentar o cambiar a celular.')}
          onHttpError={() => setVideoError('El servidor rechazó la reproducción del lente. Podés reintentar.')}
        />
      </View>}
      {remoteCamera && remoteCamera.expiresAt <= playbackRequestedAt && connected && foreground && !error && <View style={styles.center}><ActivityIndicator color="#FFFFFF" /><Text style={styles.message}>Reconectando cámara del servidor…</Text></View>}
      {!remoteCamera && usingGlasses && connected && foreground && !error && (role === 'PDV' || !directLensVideo) && <View style={StyleSheet.absoluteFill}>
        {role === 'PDV' ? <WifiLensCamera ref={camera} onReady={setReady} /> : <WebView key={feedAttempt}
          source={{ uri: `${assistanceVideoUrl}/video_feed/${call.streamPort}/${encodeURIComponent(call.streamCode)}` }}
          style={styles.video} scrollEnabled={false} accessibilityLabel="Cámara de los lentes"
          onError={() => { setVideoError('No se pudo cargar el video de los lentes. Podés reintentar o cambiar a celular.'); }}
          onHttpError={() => { setVideoError('El servidor de los lentes no respondió. Podés reintentar o cambiar a celular.'); }} />}
      </View>}
      {!foreground && <Text style={styles.message}>Volvé a Anny para ver el video.</Text>}
      {!connected && !error && foreground && <View style={styles.center}><ActivityIndicator color="#FFFFFF" size="large" /><Text style={styles.message}>Conectando llamada…</Text></View>}
      {!!error && <View style={styles.center}><Text accessibilityRole="alert" style={styles.message}>{error}</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => { setError(''); setConnected(false); setDirectLensVideo(false); setAttempt(value => value + 1); }}><Text style={styles.buttonText}>Reintentar conexión</Text></Pressable></View>}
    </View>
    {!!videoError && <Text accessibilityRole="alert" style={styles.message}>{videoError}</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.message}>{notice}</Text>}
    {usingGlasses && (remoteCamera || role === 'TUTOR') && !!videoError && <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setVideoError(''); setPlaybackRequestedAt(Date.now()); setFeedAttempt(value => value + 1); }}><Text style={styles.buttonText}>Reintentar video de lentes</Text></Pressable>}
    {connected && <Pressable accessibilityRole="button" disabled={choosing} style={styles.button} onPress={() => selectSource(!usingGlasses)}><Text style={styles.buttonText}>{choosing ? 'Conectando lente del servidor…' : usingGlasses ? 'Usar cámara del celular' : 'Usar cámara de los lentes'}</Text></Pressable>}
    <Pressable accessibilityRole="button" style={[styles.button, styles.hangup]} onPress={() => void endCall()}><Text style={styles.buttonText}>Finalizar llamada</Text></Pressable>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#17111B', padding: 16, gap: 14 }, title: { color: '#FFF', fontSize: 23, fontWeight: '700', paddingVertical: 10 },
  video: { flex: 1, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden' }, center: { ...StyleSheet.absoluteFill, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: '#17111B' },
  message: { color: '#FFF', fontSize: 18, textAlign: 'center', lineHeight: 26 }, button: { backgroundColor: '#67416E', padding: 18, alignItems: 'center', borderRadius: 16 },
  buttonText: { fontSize: 18, color: '#FFF', fontWeight: '700' }, hangup: { backgroundColor: '#B61D42' },
});
