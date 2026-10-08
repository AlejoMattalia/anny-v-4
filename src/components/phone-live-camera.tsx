import type { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { analyzeLiveFrame, disconnectLiveVision } from '@/lib/live-vision';
import { speak, stopSpeaking } from '@/lib/voice';

export function PhoneLiveCamera() {
  const cameraRef = useRef<CameraView>(null);
  const [module, setModule] = useState<typeof import('expo-camera') | null>(null);
  const [ready, setReady] = useState(false);
  const [granted, setGranted] = useState(false);
  const [status, setStatus] = useState('Preparando cámara del celular…');
  const [description, setDescription] = useState('');
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const cameraModule = await import('expo-camera');
        const current = await cameraModule.Camera.getCameraPermissionsAsync();
        const permission = current.granted ? current : await cameraModule.Camera.requestCameraPermissionsAsync();
        if (!active) return;
        setModule(cameraModule);
        setGranted(permission.granted);
        setStatus(permission.granted ? 'Iniciando cámara…' : 'Activá el permiso de cámara para usar el celular.');
      } catch {
        if (active) {
          setCameraError(true);
          setStatus('No se pudo abrir la cámara del celular.');
        }
      }
    }
    void prepare();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function capture() {
      try {
        const picture = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.55, shutterSound: false });
        if (!active) return;
        if (!picture?.base64) throw new Error('No se pudo capturar la imagen.');
        setStatus('Analizando el entorno…');
        const text = await analyzeLiveFrame(`data:image/jpeg;base64,${picture.base64}`);
        if (!active) return;
        setDescription(text);
        setStatus('Anny Vision activa · Celular');
        await speak(text);
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : 'No se pudo analizar la imagen.');
      } finally {
        if (active) timer = setTimeout(() => void capture(), 3000);
      }
    }
    timer = setTimeout(() => void capture(), 2000);
    return () => {
      active = false;
      clearTimeout(timer);
      disconnectLiveVision();
      void stopSpeaking();
    };
  }, [ready]);

  const Preview = module?.CameraView;
  return (
    <View style={styles.screen}>
      {Preview && granted ? <Preview ref={cameraRef} facing="back" mode="picture" style={StyleSheet.absoluteFill} onCameraReady={() => setReady(true)} onMountError={() => { setCameraError(true); setStatus('No se pudo iniciar la cámara.'); }} /> : null}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/help')} style={styles.button}><Text style={styles.text}>VOLVER</Text></Pressable>
          <Text style={styles.title}>Streaming · Celular</Text>
        </View>
        {!ready && !cameraError && !module ? <ActivityIndicator color="#FFFFFF" size="large" /> : null}
        <View style={styles.panel}>
          {description ? <ScrollView style={{ maxHeight: 220 }}><Text style={styles.text}>{description}</Text></ScrollView> : null}
          <Text style={styles.text}>{status}</Text>
          {module && !granted ? <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.button}><Text style={styles.text}>ABRIR AJUSTES</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={() => void stopSpeaking()} style={styles.button}><Text style={styles.text}>DETENER VOZ</Text></Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: 'rgba(3,6,10,0.88)' },
  title: { flex: 1, fontSize: 18, color: '#FFFFFF', fontWeight: '800' },
  text: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  button: { padding: 12, backgroundColor: '#6A0DAD', borderRadius: 10, alignItems: 'center' },
  panel: { padding: 14, gap: 12, backgroundColor: 'rgba(3,6,10,0.88)' },
});
