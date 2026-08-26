import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WebViewMessageEvent } from 'react-native-webview';

import { analyzeLiveFrame, disconnectLiveVision } from '@/lib/live-vision';
import { createCameraViewSession, type CameraViewSession } from '@/lib/remote-cameras';
import { speak, stopSpeaking } from '@/lib/voice';

type WebViewModule = typeof import('react-native-webview');
const WEBRTC_FRAME_CAPTURE_SCRIPT = `
  (function () {
    if (window.__annyFrameCaptureStarted) return true;
    window.__annyFrameCaptureStarted = true;
    setInterval(function () {
      try {
        var video = document.querySelector('video');
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        var maxWidth = 640;
        var scale = Math.min(1, maxWidth / video.videoWidth);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        var context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'anny-live-frame',
          image: canvas.toDataURL('image/jpeg', 0.55)
        }));
      } catch (error) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'anny-capture-error',
          message: String(error && error.message ? error.message : error)
        }));
      }
    }, 3000);
    true;
  })();
`;

export default function RemoteCameraViewScreen() {
  const params = useLocalSearchParams<{ cameraId?: string; name?: string }>();
  const cameraId = typeof params.cameraId === 'string' ? params.cameraId : '';
  const cameraName = typeof params.name === 'string' ? params.name : 'Cámara Anny';
  const [session, setSession] = useState<CameraViewSession | null>(null);
  const [webViewModule, setWebViewModule] = useState<WebViewModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState('Conectando con Anny…');
  const analyzingRef = useRef(false);
  const mountedRef = useRef(true);

  const analyzeFrame = useCallback(async (image: string) => {
    if (!cameraId || analyzingRef.current || !mountedRef.current) return;
    analyzingRef.current = true;
    setAnalysisStatus('Analizando el entorno…');
    console.log('[RemoteCameraAnalysis] cycle started', { cameraId });
    try {
      console.log('[RemoteCameraAnalysis] sending frame to vision API', {
        cameraId,
        characters: image.length,
      });
      const text = await analyzeLiveFrame(image);
      if (!mountedRef.current) return;
      setDescription(text);
      setAnalysisStatus('Anny Vision activa');
      console.log('[RemoteCameraAnalysis] description received', {
        cameraId,
        characters: text.length,
      });
      await speak(text);
    } catch (analysisError) {
      console.error('[RemoteCameraAnalysis] cycle failed', {
        cameraId,
        error: analysisError,
        errorMessage: analysisError instanceof Error ? analysisError.message : String(analysisError),
      });
      if (mountedRef.current) {
        setAnalysisStatus(
          analysisError instanceof Error ? analysisError.message : 'No se pudo analizar la imagen.',
        );
      }
    } finally {
      analyzingRef.current = false;
    }
  }, [cameraId]);

  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as {
        image?: string;
        message?: string;
        type?: string;
      };
      if (payload.type === 'anny-live-frame' && payload.image) {
        console.log('[RemoteCameraCapture] live WebRTC frame received', {
          cameraId,
          characters: payload.image.length,
        });
        void analyzeFrame(payload.image);
      } else if (payload.type === 'anny-capture-error') {
        console.error('[RemoteCameraCapture] WebRTC canvas failed', payload.message);
        setAnalysisStatus('No se pudo capturar el video en vivo.');
      }
    } catch (messageError) {
      console.error('[RemoteCameraCapture] invalid WebView message', messageError);
    }
  }, [analyzeFrame, cameraId]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    if (UIManager.getViewManagerConfig('RNCWebView')) {
      void import('react-native-webview').then((module) => active && setWebViewModule(module));
    }
    async function connect() {
      if (!cameraId) {
        setError('No se seleccionó una cámara.');
        setLoading(false);
        return;
      }
      try {
        const nextSession = await createCameraViewSession(cameraId);
        if (active) setSession(nextSession);
      } catch (connectError) {
        if (active) setError(connectError instanceof Error ? connectError.message : 'No se pudo abrir la cámara.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void connect();
    return () => {
      active = false;
      mountedRef.current = false;
      disconnectLiveVision();
      void stopSpeaking();
    };
  }, [cameraId]);

  const StreamWebView = webViewModule?.WebView;

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      {session && StreamWebView ? (
        <StreamWebView
          allowsInlineMediaPlayback
          injectedJavaScript={WEBRTC_FRAME_CAPTURE_SCRIPT}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          onError={() => setError('No se pudo mostrar el video.')}
          onHttpError={() => setError('El servidor rechazó la reproducción.')}
          onMessage={handleWebViewMessage}
          originWhitelist={['http://*', 'https://*']}
          scrollEnabled={false}
          source={{ uri: session.streamUrl }}
          style={styles.video}
        />
      ) : null}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#72D68B" size="large" />
          <Text style={styles.stateTitle}>Conectando cámara…</Text>
        </View>
      ) : null}

      {!loading && !StreamWebView && !error ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons color="#FFB95C" name="cellphone-cog" size={58} />
          <Text style={styles.stateTitle}>Recompilación necesaria</Text>
          <Text style={styles.stateText}>La reproducción requiere el módulo WebView incluido en la app nativa.</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons color="#FF6674" name="video-off-outline" size={58} />
          <Text style={styles.stateTitle}>Video no disponible</Text>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : null}

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver a cámaras" onPress={() => router.back()} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="arrow-back" size={22} />
          </Pressable>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.title}>{cameraName}</Text>
            <Text style={styles.subtitle}>TRANSMISIÓN EN VIVO</Text>
          </View>
          <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
        </View>
        <View style={styles.analysisArea}>
          {description ? (
            <View style={styles.descriptionBox}>
              <Text style={styles.descriptionLabel}>ANNY DICE</Text>
              <Text accessibilityLiveRegion="polite" style={styles.descriptionText}>{description}</Text>
            </View>
          ) : null}
          <View style={styles.analysisBadge}>
            <MaterialCommunityIcons color="#72D68B" name="eye-outline" size={16} />
            <Text numberOfLines={2} style={styles.analysisText}>{analysisStatus}</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  video: { position: 'absolute', inset: 0, backgroundColor: '#000000' },
  centerState: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 13, padding: 30, backgroundColor: '#05070B' },
  stateTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  stateText: { color: '#AEB7C7', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  overlay: { position: 'absolute', inset: 0, justifyContent: 'space-between' },
  header: { height: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, backgroundColor: 'rgba(3,6,10,0.88)' },
  backButton: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A2330' },
  headerText: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  subtitle: { color: '#8E9AAA', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 3 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, backgroundColor: 'rgba(220,45,60,0.22)', paddingHorizontal: 10, paddingVertical: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF4555' },
  liveText: { color: '#FF7A85', fontSize: 10, fontWeight: '900' },
  analysisArea: { gap: 10, padding: 14, backgroundColor: 'rgba(3,6,10,0.78)' },
  descriptionBox: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(114,214,139,0.45)', backgroundColor: 'rgba(5,10,15,0.92)', padding: 14 },
  descriptionLabel: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 5 },
  descriptionText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, fontWeight: '600' },
  analysisBadge: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: 'rgba(15,23,34,0.94)', paddingHorizontal: 12, paddingVertical: 9 },
  analysisText: { flex: 1, color: '#D5DCE8', fontSize: 12, fontWeight: '700' },
});
