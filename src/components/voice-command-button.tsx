import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSyncExternalStore } from 'react';
import { conversationIsActive, subscribeConversation } from '../services/ConversationRuntime';
import { usePathname } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAssistance } from '../context/assistance-context';
import { useVoiceCommands } from '../context/voice-commands-context';

export function VoiceCommandButton() {
  const { user } = useAssistance();
  const { listening, listen, cancel } = useVoiceCommands();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const talking = useSyncExternalStore(subscribeConversation, conversationIsActive, () => false);
  if (talking || !user || ['/', '/home', '/realtime-streaming', '/assistance-call', '/conversation'].includes(pathname)) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={listening ? 'Cancelar escucha de comandos' : 'Comandos de voz'}
    accessibilityState={{ selected: listening }} onPress={() => listening ? cancel() : void listen()}
    style={[styles.button, { bottom: Math.max(insets.bottom, 12) + 76 }, listening && styles.listening]}>
    <MaterialCommunityIcons name={listening ? 'microphone-off' : 'microphone'} size={28} color="#FFFFFF" />
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { position: 'absolute', right: 18, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3C1642', elevation: 8 },
  listening: { backgroundColor: '#B61D42' },
});
