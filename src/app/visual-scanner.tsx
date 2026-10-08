import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  analyzeVisualImage,
  type VisualAnalysisMode,
} from '@/lib/visual-analysis';
import { speak, stopSpeaking } from '@/lib/voice';
import WifiLensCamera, { type WifiLensCameraHandle } from '@/components/WifiLensCamera';
import { loadSettings } from '@/lib/settings-storage';


const MODE_CONTENT: Record<
  VisualAnalysisMode,
  {
    action: string;
    instruction: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    title: string;
  }
> = {
  read_text: {
    action: 'LEER TEXTO',
    instruction: 'Apuntá al texto y mantené el celular quieto.',
    icon: 'text-recognition',
    title: 'Escanear texto',
  },
  describe_scene: {
    action: 'DESCRIBIR IMAGEN',
    instruction: 'Apuntá al entorno que querés que Anny describa.',
    icon: 'image-search-outline',
    title: 'Escanear imagen',
  },
  identify_currency: {
    action: 'IDENTIFICAR BILLETE',
    instruction: 'Apuntá la cámara al billete completo.',
    icon: 'cash-multiple',
    title: 'Escanear billete',
  },
};

export default function VisualScannerScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = isVisualMode(params.mode) ? params.mode : 'describe_scene';
  return <VisualScanner key={mode} mode={mode} />;
}

function VisualScanner({ mode }: { mode: VisualAnalysisMode }) {
  const content = MODE_CONTENT[mode];
  const wifiCameraRef = useRef<WifiLensCameraHandle>(null);
  const mountedRef = useRef(true);
  const scanningRef = useRef(false);
  const firstScanPendingRef = useRef(true);
  const speakingRef = useRef(false);
  const [scanInterval, setScanInterval] = useState(30);
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [cycle, setCycle] = useState(0);
  const activeRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [capturedUri, setCapturedUri] = useState('');

  const readResult = useCallback(async (text: string) => {
    speakingRef.current = true;
    try {
      await speak(text, { onError: () => {
        if (mountedRef.current) setError('No se pudo reproducir la voz. Probá Volver a escuchar y revisá la voz en español del dispositivo.');
      } });
    } finally {
      speakingRef.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let current = true;
    firstScanPendingRef.current = true;
    setFocused(true);
    void loadSettings().then((settings) => {
      if (current) setScanInterval(Math.min(120, Math.max(5, Number(settings.scanInterval) || 30)));
    });
    return () => {
      current = false;
      activeRef.current = false;
      setFocused(false);
      void stopSpeaking();
    };
  }, []));

  useEffect(() => {
    activeRef.current = focused && foreground;
    const subscription = AppState.addEventListener('change', (state) => {
      activeRef.current = focused && state === 'active';
      setForeground(state === 'active');
      if (state !== 'active') void stopSpeaking();
    });
    return () => subscription.remove();
  }, [focused, foreground]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; void stopSpeaking(); };
  }, []);

  const scanImage = useCallback(async () => {
    if (!activeRef.current || !wifiCameraRef.current || !cameraReady || scanningRef.current || speakingRef.current) return;

    scanningRef.current = true;
    firstScanPendingRef.current = false;
    setIsAnalyzing(true);
    setResult('');
    setError('');
    setCapturedUri('');

    try {
      await stopSpeaking();
      const base64 = await wifiCameraRef.current!.capture();
      const picture = { base64, uri: `data:image/jpeg;base64,${base64}` };
      if (!mountedRef.current || !activeRef.current) return;
      setCapturedUri(picture.uri);

      const analysis = await analyzeVisualImage(
        `data:image/jpeg;base64,${picture.base64}`,
        mode,
      );
      if (!mountedRef.current || !activeRef.current) return;
      setResult(analysis);
      setIsAnalyzing(false);
      await readResult(analysis);
    } catch (scanError) {
      if (!mountedRef.current || !activeRef.current) return;
      const message = getErrorMessage(scanError);
      setError(message);
      setIsAnalyzing(false);
      await readResult(message);
    } finally {
      scanningRef.current = false;
      if (mountedRef.current) {
        setIsAnalyzing(false);
        setCycle((value) => value + 1);
      }
    }
  }, [cameraReady, mode, readResult]);

  useEffect(() => {
    if (!focused || !foreground || !cameraReady) return;
    const timer = setTimeout(() => {
      if (scanningRef.current || speakingRef.current) {
        setCycle((value) => value + 1);
      } else {
        void scanImage();
      }
    }, firstScanPendingRef.current ? 2000 : scanInterval * 1000);
    return () => clearTimeout(timer);
  }, [focused, foreground, cameraReady, scanInterval, scanImage, cycle]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={StyleSheet.absoluteFill}>
        <WifiLensCamera ref={wifiCameraRef} onReady={setCameraReady} />
      </View>

      <SafeAreaView pointerEvents={isAnalyzing ? 'none' : 'box-none'} accessibilityElementsHidden={isAnalyzing} importantForAccessibility={isAnalyzing ? 'no-hide-descendants' : 'auto'} style={styles.overlay}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Volver a Ayuda"
            onPress={() => router.canGoBack() ? router.back() : router.replace('/help')}
            style={styles.backButton}>
            <Ionicons color="#FFFFFF" name="chevron-back" size={25} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={styles.instruction}>{'Apuntá con la cámara del lente WiFi.'}</Text>
          </View>
          <View style={styles.headerIcon}>
            <MaterialCommunityIcons color="#FFFFFF" name={content.icon} size={22} />
          </View>
        </View>

        <View style={styles.bottomPanel}>
          <Text style={styles.listenAgainText}>ESCANEO AUTOMÁTICO · CADA {scanInterval} SEGUNDOS</Text>
          {result ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>ANNY DICE</Text>
              <ScrollView style={styles.resultScroll}>
                <Text accessibilityLiveRegion="polite" style={styles.resultText}>{result}</Text>
              </ScrollView>
              <Pressable
                accessibilityLabel="Volver a escuchar el resultado"
                onPress={() => void readResult(result)}
                style={styles.listenAgainButton}>
                <MaterialCommunityIcons color="#6A0DAD" name="volume-high" size={20} />
                <Text style={styles.listenAgainText}>VOLVER A ESCUCHAR</Text>
              </Pressable>
            </View>
          ) : null}

          {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text> : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Detener voz" onPress={() => void stopSpeaking()} style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>DETENER VOZ</Text>
          </Pressable>

          <Pressable
            accessibilityHint={content.instruction}
            accessibilityLabel={content.action}
            accessibilityRole="button"
            accessibilityState={{ disabled: !cameraReady || isAnalyzing }}
            disabled={!cameraReady || isAnalyzing}
            onPress={() => void scanImage()}
            style={({ pressed }) => [
              styles.scanButton,
              !cameraReady || isAnalyzing ? styles.scanButtonDisabled : null,
              pressed ? styles.scanButtonPressed : null,
            ]}>
            {isAnalyzing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <MaterialCommunityIcons color="#FFFFFF" name="camera" size={23} />
            )}
            <Text style={styles.scanButtonText}>
              {isAnalyzing ? 'ANALIZANDO…' : content.action}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
      {isAnalyzing ? (
        <View style={styles.analysisOverlay} onStartShouldSetResponder={() => true} accessibilityViewIsModal>
          {capturedUri ? <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.analysisShade}>
            <ActivityIndicator color="#FFFFFF" size="large" />
            <Text accessibilityLiveRegion="polite" style={styles.analysisText}>Analizando imagen…</Text>
            <Text style={styles.instruction}>Esperá un momento. Anny leerá el resultado.</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function isVisualMode(value: string | undefined): value is VisualAnalysisMode {
  return value === 'read_text' || value === 'describe_scene' || value === 'identify_currency';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'No se pudo analizar la imagen. Intentá nuevamente.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#17111A' },
  analysisOverlay: { position: 'absolute', inset: 0, zIndex: 10, backgroundColor: '#17111A' },
  analysisShade: { flex: 1, backgroundColor: 'rgba(23,17,26,0.75)', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  analysisText: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  emptyCamera: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F7F3F8',
    paddingHorizontal: 28,
  },
  emptyTitle: { color: '#3C1642', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  settingsButton: { marginTop: 8, borderRadius: 8, backgroundColor: '#6A0DAD', paddingHorizontal: 22, paddingVertical: 13 },
  settingsButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  overlay: { position: 'absolute', inset: 0, justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(60,22,66,0.92)', paddingHorizontal: 14, paddingVertical: 12 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.14)' },
  headerText: { flex: 1, gap: 2 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  instruction: { color: '#E9DDEC', fontSize: 11, lineHeight: 15 },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#8D5BFF' },
  bottomPanel: { gap: 10, backgroundColor: 'rgba(252,252,252,0.96)', padding: 14 },
  resultCard: { gap: 7, borderWidth: 1, borderColor: '#D7C9DB', borderRadius: 10, backgroundColor: '#FFFFFF', padding: 14 },
  resultLabel: { color: '#6A0DAD', fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  resultScroll: { maxHeight: 220 },
  resultText: { color: '#3C1642', fontSize: 17, lineHeight: 24, fontWeight: '700' },
  listenAgainButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3, paddingVertical: 5 },
  listenAgainText: { color: '#6A0DAD', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  errorText: { color: '#A33147', fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  scanButton: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 9, backgroundColor: '#6A0DAD' },
  scanButtonDisabled: { opacity: 0.5 },
  scanButtonPressed: { opacity: 0.76 },
  scanButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
});
