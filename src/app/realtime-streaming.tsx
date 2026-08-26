import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { CameraView as ExpoCameraView } from 'expo-camera';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  analyzeRealtimeImage,
  checkRealtimeAiHealth,
  getGlassesCaptureUrl,
  getGlassesVideoUrl,
  realtimeAiUrl,
  startGlassesStreaming,
  stopGlassesStreaming,
  type GlassesStreamingSession,
} from '@/lib/realtime-streaming';
import { listenOnce, speak, stopListening, stopSpeaking } from '@/lib/voice';

type CameraSource = 'glasses' | 'phone';
type ExpoCameraModule = typeof import('expo-camera');
type WebViewModule = typeof import('react-native-webview');

const CAPTURE_INTERVAL_MS = 3000;

export default function RealtimeStreamingScreen() {
  const cameraRef = useRef<ExpoCameraView>(null);
  const sessionRef = useRef<GlassesStreamingSession | null>(null);
  const mountedRef = useRef(true);
  const streamingRef = useRef(true);
  const awaitingResponseRef = useRef(false);
  const speakingRef = useRef(false);
  const [pulse] = useState(() => new Animated.Value(1));
  const [cameraModule, setCameraModule] = useState<ExpoCameraModule | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [webViewModule, setWebViewModule] = useState<WebViewModule | null>(null);

  const [source, setSource] = useState<CameraSource>('glasses');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const [isPreparingGlasses, setIsPreparingGlasses] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState(
    realtimeAiUrl ? 'Conectando con Anny…' : 'Configuración incompleta',
  );
  const [streamError, setStreamError] = useState(
    realtimeAiUrl ? '' : 'Falta configurar el servidor de inteligencia artificial.',
  );

  const finishAnalysis = useCallback(() => {
    awaitingResponseRef.current = false;
    if (mountedRef.current) setIsAnalyzing(false);
  }, []);

  const prepareGlasses = useCallback(async () => {
    setIsPreparingGlasses(true);
    setStreamError('');

    try {
      const previousSession = sessionRef.current;
      sessionRef.current = null;
      setVideoUrl('');
      await stopGlassesStreaming(previousSession);
      const session = await startGlassesStreaming();

      if (!mountedRef.current) {
        await stopGlassesStreaming(session);
        return;
      }

      sessionRef.current = session;
      setVideoUrl(getGlassesVideoUrl(session));
      setStatusMessage('Cámara de lentes lista. Conectando con Anny…');
    } catch (error) {
      if (!mountedRef.current) return;
      const message = getErrorMessage(error);
      setStreamError(message);
      setStatusMessage('Cámara de lentes no disponible');
      void speak(message);
    } finally {
      if (mountedRef.current) setIsPreparingGlasses(false);
    }
  }, []);

  const captureAndSend = useCallback(async (query?: string) => {
    if (
      !mountedRef.current ||
      awaitingResponseRef.current ||
      speakingRef.current
    ) {
      return;
    }

    awaitingResponseRef.current = true;
    setIsAnalyzing(true);
    setStatusMessage(query ? `Buscando: “${query}”` : 'Analizando el entorno…');

    try {
      let image: string;

      if (source === 'phone') {
        if (!cameraRef.current || !isCameraReady) {
          throw new Error('La cámara del celular todavía no está lista.');
        }
        const picture = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.12,
          shutterSound: false,
          skipProcessing: true,
        });
        if (!picture?.base64) throw new Error('No se pudo capturar la imagen.');
        image = `data:image/jpeg;base64,${picture.base64}`;
      } else {
        const session = sessionRef.current;
        if (!session) throw new Error('El streaming de los lentes no está listo.');
        image = await fetchImageAsDataUrl(getGlassesCaptureUrl(session));
      }

      if (!mountedRef.current) {
        finishAnalysis();
        return;
      }

      setCaptureCount((count) => count + 1);
      const text = await analyzeRealtimeImage(image, query);
      finishAnalysis();
      if (!mountedRef.current || !streamingRef.current) return;
      setDescription(text);
      setStatusMessage('Streaming en tiempo real');
      speakingRef.current = true;
      await speak(text);
      speakingRef.current = false;
    } catch (error) {
      finishAnalysis();
      if (!mountedRef.current) return;
      setStatusMessage(getErrorMessage(error));
    }
  }, [finishAnalysis, isCameraReady, source]);

  useEffect(() => {
    mountedRef.current = true;
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();

    if (UIManager.getViewManagerConfig('RNCWebView')) {
      void import('react-native-webview').then((module) => {
        if (mountedRef.current) setWebViewModule(module);
      });
    }

    const healthTimer = setTimeout(async () => {
      const healthy = await checkRealtimeAiHealth();
      if (!mountedRef.current) return;
      setIsConnected(healthy);
      setStatusMessage(
        healthy
          ? 'Streaming en tiempo real'
          : 'No se pudo conectar con el servicio de visión',
      );
      if (healthy) void speak('Conectado. Iniciando streaming en tiempo real.');
    }, 0);
    const prepareTimer = setTimeout(() => void prepareGlasses(), 0);

    return () => {
      mountedRef.current = false;
      streamingRef.current = false;
      clearTimeout(healthTimer);
      clearTimeout(prepareTimer);
      pulseLoop.stop();
      stopListening();
      void stopSpeaking();
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      void stopGlassesStreaming(activeSession);
    };
  }, [prepareGlasses, pulse]);

  useEffect(() => {
    if (!isStreaming || !isConnected || isListening || streamError) return;

    const firstCapture = setTimeout(() => void captureAndSend(), 900);
    const interval = setInterval(() => void captureAndSend(), CAPTURE_INTERVAL_MS);
    return () => {
      clearTimeout(firstCapture);
      clearInterval(interval);
    };
  }, [captureAndSend, isConnected, isListening, isStreaming, streamError]);

  async function toggleCameraSource() {
    if (source === 'glasses') {
      let module = cameraModule;
      try {
        module ??= await import('expo-camera');
      } catch (error) {
        const message = /ExpoCamera|native module/i.test(getErrorMessage(error))
          ? 'La cámara del celular requiere recompilar e instalar la app. Mientras tanto podés usar la cámara de los lentes.'
          : getErrorMessage(error);
        Alert.alert('Cámara no disponible', message);
        return;
      }

      const currentPermission = await module.Camera.getCameraPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await module.Camera.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso de cámara',
          'Anny necesita usar la cámara para describir lo que tenés delante.',
        );
        return;
      }

      setCameraModule(module);
      setHasCameraPermission(true);
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      setVideoUrl('');
      await stopGlassesStreaming(activeSession);
      setSource('phone');
      setStreamError('');
      setIsCameraReady(false);
      setStatusMessage(isConnected ? 'Streaming con cámara del celular' : 'Conectando con Anny…');
      void speak('Cambiando a cámara del celular.');
      return;
    }

    setSource('glasses');
    setIsCameraReady(false);
    void speak('Cambiando a cámara de los lentes.');
    await prepareGlasses();
  }

  async function askAnny() {
    if (isListening || !isStreaming) return;
    setIsListening(true);
    setStatusMessage('Te escucho…');
    try {
      const query = await listenOnce({
        prompt: '¿Qué querés saber?',
        timeoutMs: 9000,
        contextualStrings: ['Anny', 'izquierda', 'derecha', 'delante', 'objeto'],
      });
      setDescription('');
      await captureAndSend(query);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatusMessage(message);
      if (!/cancelada/i.test(message)) void speak(message);
    } finally {
      if (mountedRef.current) setIsListening(false);
    }
  }

  function toggleStreaming() {
    const nextStreaming = !isStreaming;
    streamingRef.current = nextStreaming;
    setIsStreaming(nextStreaming);
    if (!nextStreaming && isListening) {
      stopListening();
      setIsListening(false);
    }
    setStatusMessage(nextStreaming ? 'Streaming en tiempo real' : 'Streaming pausado');
    void speak(nextStreaming ? 'Streaming reanudado.' : 'Streaming pausado.');
  }

  function goBack() {
    router.back();
  }

  const showGlassesLoading = source === 'glasses' && isPreparingGlasses && !streamError;
  const PhoneCameraView = cameraModule?.CameraView;
  const StreamWebView = webViewModule?.WebView;

  return (
    <View style={styles.screen}>
      <StatusBar hidden />

      {source === 'phone' && hasCameraPermission && PhoneCameraView ? (
        <PhoneCameraView
          facing="back"
          flash="off"
          mode="picture"
          onCameraReady={() => setIsCameraReady(true)}
          onMountError={(event) => setStreamError(event.message)}
          ref={cameraRef}
          style={styles.preview}
        />
      ) : null}

      {source === 'glasses' && videoUrl && !streamError && StreamWebView ? (
        <StreamWebView
          onError={() => setStreamError('No se pudo mostrar el video de los lentes.')}
          onHttpError={() => setStreamError('El servidor no pudo mostrar el video de los lentes.')}
          scrollEnabled={false}
          source={{ uri: videoUrl }}
          style={styles.preview}
        />
      ) : null}

      {source === 'glasses' && videoUrl && !streamError && !StreamWebView ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons color="#72D68B" name="glasses" size={62} />
          <Text style={styles.centerTitle}>Streaming de lentes activo</Text>
          <Text style={styles.centerSubtitle}>
            Anny continúa capturando y describiendo el entorno. La vista de video estará disponible al recompilar la app.
          </Text>
        </View>
      ) : null}

      {showGlassesLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#72D68B" size="large" />
          <Text style={styles.centerTitle}>Iniciando lentes…</Text>
          <Text style={styles.centerSubtitle}>Preparando la transmisión de video</Text>
        </View>
      ) : null}

      {streamError ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons color="#FF6674" name="video-off-outline" size={62} />
          <Text style={styles.centerTitle}>Cámara no disponible</Text>
          <Text style={styles.centerSubtitle}>{streamError}</Text>
          {source === 'glasses' ? (
            <Pressable onPress={() => void prepareGlasses()} style={styles.retryButton}>
              <Text style={styles.retryText}>REINTENTAR</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel="Volver a Ayuda" onPress={goBack} style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="arrow-back" size={21} />
            <Text style={styles.backText}>VOLVER</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>STREAMING EN TIEMPO REAL</Text>
            <Text style={styles.headerSubtitle}>Anny Vision</Text>
          </View>
          <Image
            accessibilityLabel="ANNY"
            resizeMode="contain"
            source={require('@/assets/images/logo-white.png')}
            style={styles.logo}
          />
        </View>

        {description ? (
          <View style={styles.descriptionBox}>
            <Text style={styles.descriptionLabel}>ANNY DICE</Text>
            <Text accessibilityLiveRegion="polite" style={styles.descriptionText}>
              {description}
            </Text>
          </View>
        ) : <View />}

        <View style={styles.bottomPanel}>
          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <Animated.View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isConnected ? (isStreaming ? '#57E779' : '#FFD166') : '#FF6674',
                    transform: [{ scale: isStreaming ? pulse : 1 }],
                  },
                ]}
              />
              <Text numberOfLines={1} style={styles.statusText}>{statusMessage}</Text>
            </View>
            <View style={styles.counterBadge}>
              <MaterialCommunityIcons color="#D5DCE8" name="camera" size={15} />
              <Text style={styles.counterText}>{captureCount}</Text>
            </View>
          </View>

          {isAnalyzing ? (
            <View style={styles.analyzingRow}>
              <ActivityIndicator color="#72D68B" size="small" />
              <Text style={styles.analyzingText}>Analizando imagen…</Text>
            </View>
          ) : null}

          <View style={styles.controls}>
            <ControlButton
              icon={isStreaming ? 'pause' : 'play'}
              label={isStreaming ? 'PAUSAR' : 'INICIAR'}
              onPress={toggleStreaming}
              tone="primary"
            />
            <ControlButton
              disabled={!isStreaming || !isConnected || isAnalyzing}
              icon={isListening ? 'microphone-off' : 'microphone'}
              label={isListening ? 'ESCUCHANDO' : 'PREGUNTAR'}
              onPress={() => void askAnny()}
              tone="accent"
            />
            <ControlButton
              disabled={isPreparingGlasses}
              icon={source === 'phone' ? 'glasses' : 'cellphone'}
              label={source === 'phone' ? 'LENTES' : 'CELULAR'}
              onPress={() => void toggleCameraSource()}
              tone="neutral"
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function ControlButton({
  disabled = false,
  icon,
  label,
  onPress,
  tone,
}: {
  disabled?: boolean;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  tone: 'accent' | 'neutral' | 'primary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.controlButton,
        tone === 'primary' ? styles.controlPrimary : null,
        tone === 'accent' ? styles.controlAccent : null,
        disabled ? styles.controlDisabled : null,
      ]}>
      <MaterialCommunityIcons color="#FFFFFF" name={icon} size={21} />
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

async function fetchImageAsDataUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`No se pudo obtener imagen de los lentes (${response.status}).`);
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } finally {
    clearTimeout(timeout);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen de los lentes.'));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !result) {
        reject(new Error('La imagen de los lentes está vacía.'));
        return;
      }
      resolve(result.replace(/^data:image\/png/, 'data:image/jpeg'));
    };
    reader.readAsDataURL(blob);
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'La cámara tardó demasiado en responder.';
  }
  return error instanceof Error ? error.message : 'Ocurrió un problema con el streaming.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#020305' },
  preview: { position: 'absolute', inset: 0, backgroundColor: '#020305' },
  centerState: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#05070B',
  },
  centerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', marginTop: 15, textAlign: 'center' },
  centerSubtitle: { color: '#AEB7C7', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  retryButton: { marginTop: 20, borderRadius: 12, backgroundColor: '#4DAA57', paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  overlay: { position: 'absolute', inset: 0, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(3, 6, 10, 0.88)',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingRight: 8 },
  backText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 5 },
  headerTitle: { color: '#72D68B', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textAlign: 'center' },
  headerSubtitle: { color: '#98A3B4', fontSize: 9, marginTop: 3 },
  logo: { width: 56, height: 24 },
  descriptionBox: {
    alignSelf: 'center',
    width: '88%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(114, 214, 139, 0.48)',
    backgroundColor: 'rgba(5, 10, 15, 0.90)',
    padding: 18,
  },
  descriptionLabel: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  descriptionText: { color: '#FFFFFF', fontSize: 19, lineHeight: 27, fontWeight: '700', marginTop: 7 },
  bottomPanel: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, backgroundColor: 'rgba(3, 6, 10, 0.92)', gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, backgroundColor: '#101722', paddingHorizontal: 12, height: 39 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { flex: 1, color: '#D8DEE9', fontSize: 12, fontWeight: '800' },
  counterBadge: { height: 39, minWidth: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: '#101722' },
  counterText: { color: '#D5DCE8', fontSize: 12, fontWeight: '900' },
  analyzingRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  analyzingText: { color: '#B9C3D1', fontSize: 12, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: 8 },
  controlButton: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, backgroundColor: '#273141', paddingHorizontal: 5 },
  controlPrimary: { backgroundColor: '#4DAA57' },
  controlAccent: { backgroundColor: '#7144C7' },
  controlDisabled: { opacity: 0.42 },
  controlText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.4, textAlign: 'center' },
});
