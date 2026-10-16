import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../components/assistance-styles';
import { useAssistance } from '../context/assistance-context';
import { requestAssistancePushPermission } from '../lib/assistance-push';

export default function RemoteAssistanceScreen() {
  const assistance = useAssistance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  const waiting = ['requesting', 'waiting', 'accepted'].includes(assistance.phase);
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')}><Text style={styles.link}>‹ Volver</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Asistencia remota</Text>
      <Text style={styles.description}>{assistance.role === 'TUTOR' ? 'Cuenta tutor · Recibí solicitudes de tus personas vinculadas y acompañalas por videollamada.' : 'Pedí ayuda a un familiar o tutor vinculado. Compartiremos tu ubicación para que pueda asistirte.'}</Text>
      {!!assistance.pushError && <Text accessibilityRole="alert" style={styles.error}>{assistance.pushError}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!assistance.message && <Text accessibilityLiveRegion="polite" style={styles.description}>{assistance.message}</Text>}
      {Platform.OS === 'web' ? <Text style={styles.description}>Abrí la aplicación instalada en Android o iOS para recibir solicitudes y realizar videollamadas.</Text> : <>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void run(async () => {
          if (!await requestAssistancePushPermission()) throw new Error('Activá las notificaciones en la configuración del teléfono para recibir solicitudes.');
        })}><Text style={styles.link}>Activar avisos de asistencia</Text></Pressable>
        {assistance.role === 'PDV' && assistance.phase !== 'calling' && <Pressable accessibilityRole="button" disabled={busy && !waiting} style={styles.button} onPress={() => waiting ? assistance.cancel() : void run(assistance.request)}>
          <Text style={styles.buttonText}>{waiting ? 'Cancelar solicitud' : 'Pedir ayuda a mis tutores'}</Text>
        </Pressable>}
        {assistance.role === 'TUTOR' && !assistance.incoming && <Text style={styles.description}>No hay solicitudes pendientes. Mantené los avisos activados para recibir ayuda solicitada desde una cuenta vinculada.</Text>}
        {assistance.role === 'TUTOR' && assistance.incoming && <View style={styles.card}>
          <Text style={styles.subtitle}>{assistance.incoming.name || 'Persona vinculada'} necesita ayuda</Text>
          <Text style={styles.description}>Ubicación: {assistance.incoming.currentLocation.latitude.toFixed(5)}, {assistance.incoming.currentLocation.longitude.toFixed(5)}</Text>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void run(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${assistance.incoming!.currentLocation.latitude},${assistance.incoming!.currentLocation.longitude}`))}><Text style={styles.link}>Ver ubicación en el mapa</Text></Pressable>
          {assistance.phase === 'accepted' ? <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void run(assistance.startCall)}><Text style={styles.buttonText}>Iniciar videollamada</Text></Pressable> : assistance.phase !== 'calling' && <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void run(() => assistance.respond(true))}><Text style={styles.buttonText}>Aceptar solicitud</Text></Pressable>}
          {assistance.phase !== 'calling' && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void run(() => assistance.respond(false))}><Text style={styles.link}>No puedo responder</Text></Pressable>}
        </View>}
      </>}
      {assistance.call && <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push('/assistance-call')}><Text style={styles.buttonText}>Volver a la llamada</Text></Pressable>}
      {busy && <ActivityIndicator size="large" color="#6A0DAD" />}
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push('/tutors')}><Text style={styles.link}>{assistance.role === 'TUTOR' ? 'Personas vinculadas' : 'Mis tutores'}</Text></Pressable>
      {!assistance.role && <Text style={styles.error}>Iniciá sesión con una cuenta PDV o TUTOR para usar esta función.</Text>}
    </ScrollView>
  </SafeAreaView>;
}
