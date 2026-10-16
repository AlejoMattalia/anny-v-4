import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAssistance } from '../context/assistance-context';
import { addLinkedUser, inviteTutor, listLinkedUsers, removeLinkedUser, renameLinkedUser, type LinkedUser } from '../lib/assistance-api';
import { styles } from '../components/assistance-styles';

export default function TutorsScreen() {
  const { user, role } = useAssistance();
  const userId = user?._id;
  const [users, setUsers] = useState<LinkedUser[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    if (userId) setUsers(await listLinkedUsers(userId));
  }, [userId]);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (userId) {
      setBusy(true);
      void listLinkedUsers(userId).then(data => { if (active) setUsers(data); }).catch(() => { if (active) setMessage('No se pudieron cargar los usuarios. Volvé a intentarlo.'); }).finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, [userId]));
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.link}>‹ Volver</Text></Pressable>
    <Text accessibilityRole="header" style={styles.title}>{role === 'TUTOR' ? 'Personas vinculadas' : 'Mis tutores'}</Text>
    <Text style={styles.description}>Vinculá una cuenta existente con su correo o código de usuario, como en Anny v3.</Text>
    <TextInput accessibilityLabel="Correo o código de usuario" style={styles.input} autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} placeholder="Correo o código de usuario" keyboardType="email-address" />
    {inviting && <><Text style={styles.description}>La cuenta no existe. Podés invitarla como tutor.</Text><TextInput accessibilityLabel="Nombre del tutor" style={styles.input} value={name} onChangeText={setName} placeholder="Nombre del tutor" /></>}
    <Pressable accessibilityRole="button" disabled={busy || !email.trim() || !role || (inviting && !name.trim())} style={styles.button} onPress={() => void run(async () => {
      if (!user?._id || !role) return;
      if (inviting) { await inviteTutor(name, email); setInviting(false); setEmail(''); setName(''); setMessage('Invitación enviada.'); }
      else {
        const result = await addLinkedUser(user._id, role, email);
        if (result === false) {
          if (role === 'TUTOR') setMessage('No se encontró esa cuenta. Verificá su correo o código.');
          else setInviting(true);
        } else { setEmail(''); await reload(); setMessage('Cuenta vinculada.'); }
      }
    })}><Text style={styles.buttonText}>{inviting ? 'Enviar invitación' : 'Vincular cuenta'}</Text></Pressable>
    {inviting && <Pressable accessibilityRole="button" onPress={() => setInviting(false)}><Text style={styles.link}>Cancelar invitación</Text></Pressable>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.description}>{message}</Text>}
    {busy && <ActivityIndicator color="#6A0DAD" />}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(reload)}><Text style={styles.link}>Actualizar lista</Text></Pressable>
    {!busy && !users.length && <Text style={styles.description}>Todavía no hay cuentas vinculadas.</Text>}
    {users.map(linked => <View key={linked._id} style={styles.card}>
      <Text style={styles.subtitle}>{linked.name} {linked.lastName}</Text>
      <Text style={styles.description}>{linked.email}{linked.code ? ` · Código: ${linked.code}` : ''}</Text>
      {editing === linked._id ? <>
        <TextInput accessibilityLabel="Nombre o alias" style={styles.input} value={name} onChangeText={setName} />
        <Pressable accessibilityRole="button" disabled={busy || !name.trim()} onPress={() => void run(async () => { await renameLinkedUser(linked._id, name); setEditing(null); await reload(); })}><Text style={styles.link}>Guardar nombre</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setEditing(null)}><Text style={styles.link}>Cancelar edición</Text></Pressable>
      </> : <Pressable accessibilityRole="button" onPress={() => { setName(linked.name || ''); setEditing(linked._id); }}><Text style={styles.link}>Editar nombre</Text></Pressable>}
      {!!linked.phone && <Pressable accessibilityRole="button" onPress={() => void run(() => Linking.openURL(`tel:${linked.phone!.replace(/[^\d+]/g, '')}`))}><Text style={styles.link}>Llamar por teléfono</Text></Pressable>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('Desvincular cuenta', `¿Querés desvincular a ${linked.name || linked.email}?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Desvincular', style: 'destructive', onPress: () => void run(async () => { await removeLinkedUser(user!._id!, linked._id); await reload(); }) }])}><Text style={styles.error}>Desvincular</Text></Pressable>
    </View>)}
  </ScrollView></SafeAreaView>;
}
