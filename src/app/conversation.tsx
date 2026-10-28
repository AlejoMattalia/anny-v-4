import { useEffect } from 'react';
import { View } from 'react-native';
import { useConversation } from '@/context/conversation-context';
export default function ConversationScreen() {
  const { running, start } = useConversation();
  useEffect(() => { if (!running) start(); }, []);
  return <View style={{ flex: 1, backgroundColor: '#17101F' }} />;
}
