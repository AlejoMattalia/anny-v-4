import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { CameraView as ExpoCameraView } from 'expo-camera';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  analyzeRealtimeImage,
  checkRealtimeAiHealth,
  disconnectRealtimeAi,
  realtimeAiUrl,
  setRealtimeMode,
} from '@/lib/realtime-streaming';
import StreamingModePicker from '@/components/StreamingModePicker';
import { STREAMING_MODES, parseStreamingModeCommand, type StreamingMode } from '@/services/StreamingModes';
import WifiLensCamera, { type WifiLensCameraHandle } from '@/components/WifiLensCamera';
import { useWifiLens } from '@/context/wifi-lens-context';
import { useWifiLensButtons } from '@/context/useWifiLensButtons';
import { listenOnce, speak, stopListening, stopSpeaking } from '@/lib/voice';

type CameraSource = 'glasses' | 'phone';
type ExpoCameraModule = typeof import('expo-camera');

const CAPTURE_INTERVAL_MS = 1500;

export default function RealtimeStreamingScreen() {
  const cameraRef = useRef<ExpoCameraView>(null);
  const wifiCameraRef = useRef<WifiLensCameraHandle>(null);
  const { wifiLensConnection } = useWifiLens();
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const mountedRef = useRef(true);
  const streamingRef = useRef(true);
  const awaitingResponseRef = useRef(false);
  const speakingRef = useRef(false);
  const activeRef = useRef(false);
  const modeGeneration = useRef(0);
  const [activeMode, setActiveMode] = useState<StreamingMode>('viaje');
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [pulse] = useState(() => new Animated.Value(1));
  const [cameraModule, setCameraModule] = useState<ExpoCameraModule | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);

  const [source, setSource] = useState<CameraSource>('glasses');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const [isPreparingGlasses, setIsPreparingGlasses] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [description, setDescription] = useState('');
  const [statusMessage, setStatusMessage] = useState(
    realtimeAiUrl ? 'Conectando con Anny…' : 'Configuración incompleta',
  );
  const [streamError, setStreamError] = useState(
    realtimeAiUrl ? '' : 'Falta configurar el servidor de inteligencia artificial.',
  );

  useEffect(() => {
    activeRef.current = focused && AppState.currentState === 'active';
    return () => {
      activeRef.current = false;
      stopListening();
      void stopSpeaking();
    };
  }, [focused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      activeRef.current = focused && state === 'active';
      setForeground(state === 'active');
      if (state !== 'active') { stopListening(); void stopSpeaking(); }
    });
    return () => subscription.remove();
  }, [focused]);

  const finishAnalysis = useCallback((generation: number) => {
    if (generation !== modeGeneration.current) return;
    awaitingResponseRef.current = false;
    if (mountedRef.current) setIsAnalyzing(false);
  }, []);

  async function changeStreamingMode(mode: StreamingMode) {
    const generation = ++modeGeneration.current;
    setRealtimeMode(mode);
    stopListening();
    setIsListening(false);
    awaitingResponseRef.current = false;
    setIsAnalyzing(false);
    setDescription('');
    setActiveMode(mode);
    setStatusMessage(`Modo ${STREAMING_MODES[mode].label}`);
    speakingRef.current = true;
    try {
      await stopSpeaking();
      if (mountedRef.current && generation === modeGeneration.current) {
        await speak(`Modo ${STREAMING_MODES[mode].label} activado.`);
      }
    } finally {
      if (generation === modeGeneration.current) speakingRef.current = false;
    }
  }

  const prepareGlasses = useCallback(async () => {
    setIsPreparingGlasses(true);
    setStreamError('');
    setCameraAttempt((attempt) => attempt + 1);
  }, []);
  const handleWifiReady = useCallback((ready: boolean) => setIsPreparingGlasses(!ready), []);
  useWifiLensButtons(focused && source === 'glasses' ? wifiLensConnection.session : null, () => {
    if (isListening) stopListening();
    else void askAnny();
  });

  const captureAndSend = useCallback(async (query?: string) => {
    if (
      !mountedRef.current ||
      !activeRef.current ||
      awaitingResponseRef.current ||
      speakingRef.current || modePickerOpen
    ) {
      return;
    }

    awaitingResponseRef.current = true;
    const generation = modeGeneration.current;
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
          quality: 0.8,
          shutterSound: false,
          skipProcessing: true,
        });
        if (!picture?.base64) throw new Error('No se pudo capturar la imagen.');
        image = `data:image/jpeg;base64,${picture.base64}`;
      } else {
        if (!wifiCameraRef.current) throw new Error('Esperá a que se conecte la cámara de los lentes.');
        image = `data:image/jpeg;base64,${await wifiCameraRef.current.capture()}`;
      }

      if (!mountedRef.current || !activeRef.current || generation !== modeGeneration.current) {
        finishAnalysis(generation);
        return;
      }

      setCaptureCount((count) => count + 1);
      const text = await analyzeRealtimeImage(image, query);
      finishAnalysis(generation);
      if (!mountedRef.current || !activeRef.current || !streamingRef.current || generation !== modeGeneration.current) return;
      setDescription(text);
      setStatusMessage('Streaming en tiempo real');
      speakingRef.current = true;
      await speak(text);
      if (generation === modeGeneration.current) speakingRef.current = false;
    } catch (error) {
      finishAnalysis(generation);
      if (!mountedRef.current || generation !== modeGeneration.current) return;
      setStatusMessage(getErrorMessage(error));
    }
  }, [finishAnalysis, isCameraReady, source, modePickerOpen]);

  useEffect(() => {
    mountedRef.current = true;
    streamingRef.current = true;
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();

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

    return () => {
      mountedRef.current = false;
      streamingRef.current = false;
      clearTimeout(healthTimer);
      pulseLoop.stop();
      stopListening();
      void stopSpeaking();
      disconnectRealtimeAi();
    };
  }, [pulse]);

  useEffect(() => {
    if (!focused || !foreground || !isStreaming || !isConnected || isListening || modePickerOpen || streamError) return;

    const firstCapture = setTimeout(() => void captureAndSend(), 900);
    const interval = setInterval(() => void captureAndSend(), CAPTURE_INTERVAL_MS);
    return () => {
      clearTimeout(firstCapture);
      clearInterval(interval);
    };
  }, [captureAndSend, focused, foreground, isConnected, isListening, isStreaming, streamError, activeMode, modePickerOpen]);

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
    const generation = modeGeneration.current;
    setIsListening(true);
    setStatusMessage('Te escucho…');
    try {
      const query = await listenOnce({
        prompt: '¿Qué querés saber?',
        timeoutMs: 9000,
        contextualStrings: ['Anny', 'izquierda', 'derecha', 'delante', 'objeto', ...Object.values(STREAMING_MODES).map(mode => `modo ${mode.label.toLowerCase()}`)],
      });
      if (!mountedRef.current || generation !== modeGeneration.current) return;
      const mode = parseStreamingModeCommand(query);
      if (mode) {
        await changeStreamingMode(mode);
        return;
      }
      setDescription('');
      await captureAndSend(query);
    } catch (error) {
      if (!mountedRef.current || generation !== modeGeneration.current) return;
      const message = getErrorMessage(error);
      setStatusMessage(message);
      if (!/cancelada/i.test(message)) void speak(message);
    } finally {
      if (mountedRef.current && generation === modeGeneration.current) setIsListening(false);
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
    if (router.canGoBack()) router.back();
    else router.replace('/help');
  }

  const PhoneCameraView = cameraModule?.CameraView;

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

      {source === 'glasses' ? (
        <View style={styles.preview}>
          <WifiLensCamera key={cameraAttempt} ref={wifiCameraRef} onReady={handleWifiReady} />
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
        <View>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel="Volver a Ayuda" accessibilityRole="button" hitSlop={8} onPress={goBack} style={styles.backButton}>
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
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <StreamingModePicker mode={activeMode} onSelect={mode => void changeStreamingMode(mode)} onVisibilityChange={setModePickerOpen} />
        </View>
        </View>

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

          {description ? (
            <View style={styles.descriptionBox}>
              <Text style={styles.descriptionLabel}>ANNY DICE</Text>
              <Text accessibilityLiveRegion="polite" style={styles.descriptionText}>
                {description}
              </Text>
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
    backgroundColor: '#FCFCFC',
  },
  centerTitle: { color: '#3C1642', fontSize: 20, fontWeight: '900', marginTop: 15, textAlign: 'center' },
  centerSubtitle: { color: '#5B465F', fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(114, 214, 139, 0.48)',
    backgroundColor: 'rgba(5, 10, 15, 0.90)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  descriptionLabel: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  descriptionText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, fontWeight: '600', marginTop: 4 },
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
