import { Ionicons } from '@expo/vector-icons';
import { CameraView, scanFromURLAsync, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WifiLensCamera, { type WifiLensCameraHandle } from '../components/WifiLensCamera';
import { useWifiLens } from '../context/wifi-lens-context';
import { useAppControl } from '@/context/useAppControl';
import { useVoiceActions } from '../context/voice-commands-context';
import { getJson } from '../lib/api';
import { speak } from '../lib/voice';
import SavedNetworksService from '../services/SavedNetworksService';
import { isWebQr, parseWifiQr } from '../services/QrCodes';

const types: BarcodeType[] = ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'codabar', 'itf14', 'pdf417', 'aztec', 'datamatrix'];
export default function QrScannerScreen() {
  const { wifiLensConnection, connect } = useWifiLens();
  const params = useLocalSearchParams<{ networkType?: string }>();
  const [source, setSource] = useState<'glasses' | 'phone'>(wifiLensConnection.phase === 'connected' ? 'glasses' : 'phone');
  const lens = useRef<WifiLensCameraHandle>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const askedPermission = useRef(false);
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Apuntá al código QR o de barras.');
  const busy = useRef(false);
  const generation = useRef(0);
  const active = useRef(false);
  const invalidate = useCallback(() => { active.current = false; generation.current++; busy.current = false; }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    active.current = focused && foreground;
    return invalidate;
  }, [focused, foreground, source, invalidate]);
  useEffect(() => {
    if (source === 'phone' && focused && foreground && !permission?.granted && !askedPermission.current) {
      askedPermission.current = true; void requestPermission();
    }
  }, [source, focused, foreground, permission?.granted, requestPermission]);
  const handleCode = useCallback(async (data: string) => {
    if (busy.current || !active.current) return;
    busy.current = true; setPaused(true);
    const request = generation.current;
    const current = () => active.current && request === generation.current;
    try {
      const network = parseWifiQr(data);
      if (network) {
        const saved = await SavedNetworksService.getAll();
        if (!current()) return;
        const networkType = params.networkType === 'hotspot' ? 'hotspot' : 'wifi';
        if (saved.length >= 8 && !saved.some(item => item.ssid === network.ssid && item.type === networkType)) throw new Error('Ya hay ocho redes guardadas. Eliminá una desde Dispositivos.');
        const selected = await SavedNetworksService.add(network.ssid, network.password, networkType);
        if (!current()) return;
        setStatus(`Red ${network.ssid} guardada. Conectando lentes…`);
        await speak(`Red ${network.ssid} guardada. Conectando lentes.`);
        if (current()) await connect(selected);
        return;
      }
      if (isWebQr(data)) {
        setStatus('Abriendo la página del código.');
        await speak('Abriendo página web.');
        if (current()) await Linking.openURL(data);
        return;
      }
      setStatus('Buscando el producto…');
      const response = await getJson<{ product?: { desc?: string; marca?: string } }>(`/api/product/${encodeURIComponent(data)}`).catch(error => {
        if (error instanceof Error && /404/.test(error.message)) return { product: undefined };
        throw new Error('No pudimos consultar el producto. Revisá tu conexión e intentá nuevamente.');
      });
      if (!current()) return;
      const product = response.product;
      const description = product ? `Esto es ${product.desc || 'un producto'}${product.marca ? ` de marca ${product.marca}` : ''}.` : 'No se ha encontrado este producto en nuestra base de datos.';
      setStatus(description); await speak(description);
    } catch (error) {
      if (current()) { const message = error instanceof Error ? error.message : 'No se pudo leer el código.'; setStatus(message); await speak(message); }
    }
  }, [connect, params.networkType]);
  const rescan = () => { generation.current++; busy.current = false; setPaused(false); setStatus('Apuntá al código QR o de barras.'); setAttempt(value => value + 1); };
  useVoiceActions({ repeat: rescan });
  useAppControl({ source, cameraReady: ready, paused, result: status }, { scan_code: () => { rescan(); return { ok: true, message: 'Escáner QR activo. Apuntá al código; el resultado se comunicará al detectarlo.' }; } });
  useEffect(() => {
    if (source !== 'glasses' || !ready || !focused || !foreground || paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function scan() {
      try {
        const frame = await lens.current?.capture();
        if (stopped || !frame) return;
        const results = await scanFromURLAsync(`data:image/jpeg;base64,${frame}`, types);
        if (!stopped && results[0]?.data) { await handleCode(results[0].data); return; }
      } catch (error) {
        if (!stopped) setStatus(error instanceof Error ? error.message : 'Esperando una imagen de los lentes.');
      }
      if (!stopped) timer = setTimeout(() => void scan(), 1000);
    }
    void scan();
    return () => { stopped = true; clearTimeout(timer); };
  }, [source, ready, focused, foreground, paused, attempt, handleCode]);
  function toggleSource() { generation.current++; busy.current = false; setReady(false); setPaused(false); setSource(value => value === 'phone' ? 'glasses' : 'phone'); }
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()}><Ionicons name="arrow-back" size={28} color="#FFFFFF" /></Pressable><Text style={styles.title}>Códigos Anny</Text></View>
    <View style={styles.preview}>
      {source === 'glasses' ? <WifiLensCamera ref={lens} active={focused && foreground} onReady={setReady} /> : focused && foreground && permission?.granted ?
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: types }} onBarcodeScanned={paused ? undefined : event => void handleCode(event.data)} /> :
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => { if (permission?.canAskAgain === false) void Linking.openSettings(); else void requestPermission(); }}><Text style={styles.buttonText}>Habilitar cámara del celular</Text></Pressable>}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.message}>{status}</Text>
    <Pressable accessibilityRole="button" style={styles.button} onPress={toggleSource}><Text style={styles.buttonText}>{source === 'phone' ? 'Usar cámara de los lentes' : 'Usar cámara del celular'}</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.button} onPress={rescan}><Text style={styles.buttonText}>Escanear otro código</Text></Pressable>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 18, gap: 14, backgroundColor: '#17111B' }, header: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' }, preview: { flex: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000000' },
  message: { color: '#FFFFFF', fontSize: 18, textAlign: 'center', lineHeight: 25 }, button: { padding: 17, borderRadius: 14, alignItems: 'center', backgroundColor: '#67416E' },
  buttonText: { fontSize: 18, color: '#FFFFFF', fontWeight: '600' },
});
