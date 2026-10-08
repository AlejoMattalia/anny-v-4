import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WifiLensConnectionCard } from './wifi-lens-connection-card';
import { useWifiLens } from '@/context/wifi-lens-context';
import SavedNetworksService from '@/services/SavedNetworksService';
import { scanLensNetworks } from '@/services/scanLensNetworks';
import { nearbyNetworkOptions, type NearbyNetworkOption } from '@/services/nearbyNetworkOptions';
import { validateLensWifi } from '@/services/LensAutoProvisioning';
import { speak } from '@/lib/voice';
import type { SavedNetwork } from '@/types/savedNetwork';

export function WifiLensNetworks() {
  const { networks, networkPreference, wifiLensConnection: connection, connect, manager } = useWifiLens();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavedNetwork | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [detected, setDetected] = useState<NearbyNetworkOption[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const busy = connection.phase === 'searching' || connection.phase === 'connecting';
  const typeName = networkPreference === 'hotspot' ? 'Hotspot' : 'WiFi';
  const compatibilityHint = 'El lente necesita 2,4 GHz. En iPhone activá “Maximizar compatibilidad”.';
  const needsCompatibility = detected.some((network) => network.ssid === ssid && network.requires24GHz);
  async function scan() {
    setScanning(true);
    try { setDetected(nearbyNetworkOptions(await scanLensNetworks())); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo buscar redes.'); }
    finally { setScanning(false); }
  }
  function openForm(network: SavedNetwork | null) {
    setEditing(network); setSsid(network?.ssid ?? ''); setPassword(network?.password ?? '');
    setShowPassword(false); setMessage(''); setDetected([]); setFormOpen(true);
    if (!network) void scan();
  }
  async function save() {
    setSaving(true); setMessage('');
    try {
      const name = ssid.trim();
      validateLensWifi(name, password);
      if (!editing && networks.length >= 8 && !networks.some((network) => network.type === networkPreference && network.ssid === name)) throw new Error('Los lentes admiten hasta 8 redes entre WiFi y Hotspot.');
      if (editing) await SavedNetworksService.update(editing.id, name, password);
      else await SavedNetworksService.add(name, password, networkPreference);
      setFormOpen(false); setPassword('');
      void speak(editing ? 'Red actualizada.' : 'Red guardada. Tocá Conectar para usarla.');
      // Same as v3: saving an alternative never interrupts the active camera.
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la red.'); }
    finally { setSaving(false); }
  }
  function remove(network: SavedNetwork) {
    Alert.alert('Eliminar red', `¿Querés eliminar “${network.ssid}”?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => { void SavedNetworksService.remove(network.id).catch(() => setMessage('No se pudo eliminar la red.')); } },
    ]);
  }
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}>
      <Pressable accessibilityLabel="Volver" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')}><Ionicons name="chevron-back" size={26} color="#3C1642" /></Pressable>
      <Text style={styles.title}>Dispositivos</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <WifiLensConnectionCard showManage={false} compact />
      {networks.filter((network) => network.type === networkPreference).map((network) => {
        const connected = connection.phase === 'connected' && connection.ssid === network.ssid && connection.session?.networkType === network.type;
        const connecting = busy && connection.target === network.ssid;
        return <View key={network.id} style={styles.network}>
          <View style={styles.networkRow}>
          <Text accessibilityLabel={network.ssid} numberOfLines={1} style={styles.networkName}>{network.ssid}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || connected, busy: connecting }} accessibilityLabel={connecting ? `Conectando a ${network.ssid}` : connected ? `Conectado a ${network.ssid}` : `Conectar a ${network.ssid}`} disabled={busy || connected} onPress={() => void connect(network).catch(() => setMessage('No se pudo conectar. Volvé a intentar.'))} style={[styles.connectButton, connected && styles.connected, connecting && styles.connecting]}>
            <Text accessibilityLiveRegion="polite" style={[styles.connectText, connected && styles.connectedText]}>{connecting ? 'Conectando…' : connected ? 'Conectado' : 'Conectar'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${network.ssid}`} onPress={() => openForm(network)} style={styles.rowAction}>
            <Ionicons name="create-outline" size={19} color="#6A0DAD" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Eliminar ${network.ssid}`} onPress={() => remove(network)} style={styles.rowAction}>
            <Ionicons name="trash-outline" size={18} color="#A32030" />
          </Pressable>
          </View>
        </View>;
      })}
      {!networks.some((network) => network.type === networkPreference) ? <Text style={styles.empty}>Sin redes guardadas</Text> : null}
      <View style={styles.footer}>
      <Pressable accessibilityRole="button" onPress={() => openForm(null)} style={styles.secondaryButton}><Ionicons name="add" size={17} color="#6A0DAD" /><Text style={styles.secondaryText}>Agregar red</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Reintentar conexión" disabled={busy} onPress={() => void manager.refresh(true, true)} style={styles.retry}>{busy ? <ActivityIndicator size="small" color="#6A0DAD" /> : <Ionicons name="refresh" size={20} color="#6A0DAD" />}</Pressable>
      </View>
      {!formOpen && message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
    </ScrollView>
    <Modal visible={formOpen} animationType="slide" onRequestClose={() => setFormOpen(false)}>
      <SafeAreaView style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.title}>{editing ? 'Editar' : 'Agregar'} {typeName}</Text>
        {!editing ? <>
          <Text style={styles.subtitle}>Redes disponibles cercanas</Text>
          {scanning ? <ActivityIndicator color="#6A0DAD" /> : <Pressable onPress={() => void scan()}><Text style={styles.link}>Buscar redes de nuevo</Text></Pressable>}
          {detected.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.nearbyRow} style={styles.nearbyScroll}>
            {detected.map(({ssid: name, requires24GHz}) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`Seleccionar red ${name}${requires24GHz ? ', requiere 2,4 GHz' : ''}`} accessibilityState={{ selected: ssid === name }} onPress={() => { setSsid(name); setPassword(''); if (requires24GHz) void speak(compatibilityHint); }} style={[styles.nearbyNetwork, ssid === name && styles.nearbySelected]}>
              <Ionicons name="wifi-outline" size={16} color={ssid === name ? '#FFFFFF' : '#6A0DAD'} />
              <Text numberOfLines={1} style={[styles.nearbyName, ssid === name && styles.nearbySelectedText]}>{name}</Text>
              {requires24GHz ? <Ionicons name="warning-outline" size={16} color={ssid === name ? '#FFFFFF' : '#936000'} /> : null}
            </Pressable>)}
          </ScrollView> : null}
        </> : null}
        {needsCompatibility ? <Text accessibilityLiveRegion="polite" style={styles.compatibility}>{compatibilityHint}</Text> : null}
        <Text style={styles.text}>Nombre de red</Text>
        <TextInput accessibilityLabel="Nombre de red" autoCapitalize="none" autoCorrect={false} value={ssid} onChangeText={setSsid} style={styles.input} />
        <Text style={styles.text}>Contraseña de la red</Text>
        <TextInput accessibilityLabel="Contraseña de la red" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} style={styles.input} />
        <Pressable onPress={() => setShowPassword(!showPassword)}><Text style={styles.link}>{showPassword ? 'Ocultar' : 'Mostrar'} contraseña</Text></Pressable>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
        <Pressable disabled={saving} onPress={() => void save()} style={styles.button}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Guardar</Text>}</Pressable>
        <Pressable onPress={() => { setFormOpen(false); setPassword(''); }}><Text style={styles.link}>Cancelar</Text></Pressable>
      </ScrollView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCFCFC' }, header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 10 }, title: { fontSize: 23, fontWeight: '800', color: '#3C1642' }, subtitle: { fontSize: 19, fontWeight: '700', color: '#3C1642' },
  text: { color: '#3C1642', fontSize: 16, lineHeight: 23 }, network: { borderWidth: 1, borderColor: '#E9E3ED', backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }, networkName: { flex: 1, fontSize: 14, color: '#3C1642', fontWeight: '600' },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  rowAction: { width: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  nearbyScroll: { flexGrow: 0 }, nearbyRow: { gap: 8, paddingBottom: 8 },
  nearbyNetwork: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#DED5E0', backgroundColor: '#F5F0F8' },
  nearbyName: { color: '#3C1642', fontSize: 13, fontWeight: '600' }, nearbySelected: { backgroundColor: '#6A0DAD', borderColor: '#6A0DAD' }, nearbySelectedText: { color: '#FFFFFF' },
  connectButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#6A0DAD' }, connectText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  connected: { backgroundColor: '#E8F5EB' }, connectedText: { color: '#247039' }, connecting: { backgroundColor: '#84708F' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }, secondaryButton: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 }, secondaryText: { fontSize: 13, color: '#6A0DAD', fontWeight: '600' }, retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, empty: { color: '#796B80', fontSize: 13, paddingVertical: 12 },
  button: { borderRadius: 10, padding: 15, backgroundColor: '#6A0DAD', alignItems: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  link: { color: '#6A0DAD', fontSize: 13, paddingVertical: 8 }, error: { color: '#A32030', fontSize: 14 },
  compatibility: { color: '#795000', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#DED5E0', color: '#3C1642', borderRadius: 10, padding: 15, fontSize: 17 },
});
