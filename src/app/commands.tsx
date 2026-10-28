import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAssistance } from '../context/assistance-context';
import { useVoiceCommands } from '../context/voice-commands-context';
import { VOICE_COMMANDS, isVoiceCommandAllowed } from '../services/VoiceCommands';
import { speak, stopSpeaking } from '../lib/voice';

export default function CommandsScreen() {
  const { user } = useAssistance();
  const voice = useVoiceCommands();
  const roles = user?.roles?.flatMap(role => role.name ? [role.name] : []) ?? [];
  const commands = VOICE_COMMANDS.filter(command => isVoiceCommandAllowed(command, roles));
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')}><Ionicons name="arrow-back" size={28} color="#3C1642" /></Pressable><Text style={styles.title}>Comandos de voz</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Tocá el micrófono o el botón de tus lentes y decí un comando. En Streaming también podés decir «Anny» seguido del comando al tocar Preguntar.</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => voice.listening ? voice.cancel() : void voice.listen()}><Text style={styles.buttonText}>{voice.listening ? 'Cancelar escucha' : 'Activar comandos de voz'}</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.stop} onPress={() => void stopSpeaking()}><Text>Detener voz</Text></Pressable>
      {commands.map((command, index) => <Pressable key={`${command.name}-${index}`} accessibilityRole="button" accessibilityLabel={`Escuchar comando ${command.name}. ${command.description}`}
        style={styles.card} onPress={() => void speak(`${command.name}. ${command.description}${command.scope ? ` ${command.scope}.` : ''}`)}>
        <Text style={styles.name}>{command.name}</Text><Text style={styles.description}>{command.description}</Text>{command.scope && <Text style={styles.scope}>{command.scope}</Text>}
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F4F8' }, header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 22 },
  title: { color: '#3C1642', fontSize: 25, fontWeight: '700' }, content: { paddingHorizontal: 22, paddingBottom: 155, gap: 12 },
  intro: { fontSize: 17, lineHeight: 25, color: '#4B3B50' }, button: { backgroundColor: '#3C1642', padding: 17, borderRadius: 14, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' }, stop: { padding: 15, alignItems: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 18, gap: 7 }, name: { fontSize: 20, fontWeight: '700', color: '#3C1642' },
  description: { fontSize: 16, lineHeight: 23, color: '#514B54' }, scope: { fontSize: 14, color: '#6A0DAD' },
});
