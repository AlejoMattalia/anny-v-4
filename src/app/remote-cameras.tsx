import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  claimRemoteCamera,
  getRemoteCameras,
  type RemoteCamera,
} from '@/lib/remote-cameras';
import { speak } from '@/lib/voice';

export default function RemoteCamerasScreen() {
  const [cameras, setCameras] = useState<RemoteCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimVisible, setClaimVisible] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCameras = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setCameras(await getRemoteCameras());
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCameras();
    }, [loadCameras]),
  );

  async function claimCamera() {
    if (!activationCode.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await claimRemoteCamera(activationCode);
      setClaimVisible(false);
      setActivationCode('');
      await loadCameras();
      void speak(`${result.camera.name} fue vinculada correctamente.`);
    } catch (claimError) {
      setError(getErrorMessage(claimError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.glow} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.iconButton}>
            <Ionicons color="#3C1642" name="arrow-back" size={23} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>ANNY VISION</Text>
            <Text style={styles.title}>Mis cámaras</Text>
          </View>
          <Pressable accessibilityLabel="Vincular cámara" onPress={() => setClaimVisible(true)} style={styles.addButton}>
            <Ionicons color="#FFFFFF" name="add" size={25} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#72D68B" size="large" />
            <Text style={styles.stateText}>Buscando tus cámaras…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl onRefresh={() => void loadCameras(true)} refreshing={refreshing} tintColor="#72D68B" />}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {cameras.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons color="#72D68B" name="video-wireless-outline" size={54} />
                <Text style={styles.emptyTitle}>Todavía no hay cámaras</Text>
                <Text style={styles.emptyText}>Vinculá un lente con el código incluido en el equipo.</Text>
                <Pressable onPress={() => setClaimVisible(true)} style={styles.primaryButton}>
                  <Text style={styles.primaryText}>VINCULAR CÁMARA</Text>
                </Pressable>
              </View>
            ) : cameras.map((camera) => (
              <Pressable
                accessibilityLabel={`${camera.name}. ${camera.online ? 'Transmitiendo' : 'Sin señal'}`}
                disabled={!camera.enabled}
                key={camera.id}
                onPress={() => router.push(
                  `/remote-camera-view?cameraId=${encodeURIComponent(camera.id)}&name=${encodeURIComponent(camera.name)}` as Href,
                )}
                style={[styles.cameraCard, !camera.enabled ? styles.disabled : null]}>
                <View style={styles.cameraIcon}>
                  <MaterialCommunityIcons color="#FFFFFF" name="cctv" size={28} />
                </View>
                <View style={styles.cameraText}>
                  <Text style={styles.cameraName}>{camera.name}</Text>
                  <Text style={styles.cameraId}>{camera.id}</Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, !camera.online ? styles.statusOff : null]} />
                    <Text style={styles.statusText}>{!camera.enabled ? 'Deshabilitada' : camera.online ? 'Transmitiendo' : 'Sin señal'}</Text>
                  </View>
                </View>
                <Ionicons color="#72D68B" name="chevron-forward" size={25} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <Modal animationType="fade" onRequestClose={() => setClaimVisible(false)} transparent visible={claimVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Vincular cámara</Text>
            <Text style={styles.modalText}>Ingresá el código de activación entregado con el lente.</Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setActivationCode}
              placeholder="Ejemplo: A1B2C3D4"
              placeholderTextColor="#687487"
              style={styles.input}
              value={activationCode}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable disabled={busy} onPress={() => setClaimVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>CANCELAR</Text>
              </Pressable>
              <Pressable disabled={busy || !activationCode.trim()} onPress={() => void claimCamera()} style={styles.primaryButton}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>VINCULAR</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCFCFC' },
  glow: { position: 'absolute', right: -110, top: -90, width: 290, height: 290, borderRadius: 145, backgroundColor: 'rgba(77,170,87,0.16)' },
  safeArea: { flex: 1, paddingHorizontal: 18 },
  header: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13 },
  iconButton: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2EDF3', borderWidth: 1, borderColor: '#DED5E0' },
  headerText: { flex: 1 },
  eyebrow: { color: '#72D68B', fontSize: 10, fontWeight: '900', letterSpacing: 1.7 },
  title: { color: '#3C1642', fontSize: 28, fontWeight: '900', marginTop: 2 },
  addButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4DAA57' },
  content: { paddingTop: 16, paddingBottom: 36, gap: 13 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  stateText: { color: '#6F5873', fontSize: 15 },
  errorText: { color: '#FF8994', fontSize: 13, lineHeight: 18 },
  emptyCard: { alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, borderColor: '#DED5E0', backgroundColor: '#FFFFFF', padding: 28 },
  emptyTitle: { color: '#3C1642', fontSize: 20, fontWeight: '900' },
  emptyText: { color: '#5B465F', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  cameraCard: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(77,170,87,0.28)', backgroundColor: '#F1F8F3', padding: 16 },
  disabled: { opacity: 0.5 },
  cameraIcon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4DAA57' },
  cameraText: { flex: 1, gap: 4 },
  cameraName: { color: '#3C1642', fontSize: 17, fontWeight: '900' },
  cameraId: { color: '#6F5873', fontSize: 11 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#57E779' },
  statusOff: { backgroundColor: '#FF6674' },
  statusText: { color: '#4F3654', fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.78)', padding: 22 },
  modalCard: { borderRadius: 22, borderWidth: 1, borderColor: '#DED5E0', backgroundColor: '#FFFFFF', padding: 22, gap: 14 },
  modalTitle: { color: '#3C1642', fontSize: 22, fontWeight: '900' },
  modalText: { color: '#4F3654', fontSize: 14, lineHeight: 20 },
  input: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: '#DED5E0', backgroundColor: '#F6F2F7', color: '#3C1642', paddingHorizontal: 15, fontSize: 17, fontWeight: '800', letterSpacing: 1.5 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 3 },
  primaryButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#4DAA57', paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  secondaryButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#EBE9ED', paddingHorizontal: 16 },
  secondaryText: { color: '#3C1642', fontSize: 12, fontWeight: '900' },
});
