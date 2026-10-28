import { getAuthSession } from './auth';
import { conversationDeadline } from '../services/ConversationStartup';

export const voiceApiUrl = (process.env.EXPO_PUBLIC_VOICE_API_URL || 'https://anny-voice.3.15.63.191.sslip.io').replace(/\/$/, '');
export type ConversationSession = { ticket: string; url: string; expiresIn: number; maxSessionSeconds: number };

export async function createVoiceConversation(signal: AbortSignal): Promise<ConversationSession> {
  const session = await conversationDeadline(getAuthSession(), 8000, 'No pudimos leer tu sesión. Cerrá y abrí Anny e intentá nuevamente.', signal);
  if (!session?.access_token) throw new Error('Iniciá sesión para hablar con Anny.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = setTimeout(cancel, 20000);
  signal.addEventListener('abort', cancel);
  if (signal.aborted) cancel();
  try {
    const response = await conversationDeadline(fetch(`${voiceApiUrl}/api/bootstrap`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 2 }), signal: controller.signal,
    }), 20000, 'No pudimos conectar con el servidor de voz. Revisá internet e intentá nuevamente.', controller.signal);
    const data = await conversationDeadline(response.json(), 8000, 'El servidor de voz no terminó de responder.', controller.signal);
    if (!response.ok) throw new Error(data.error || 'No pudimos iniciar la conversación.');
    if (typeof data.ticket !== 'string' || !/^[\w-]{40,100}$/.test(data.ticket) ||
        typeof data.url !== 'string' || new URL(data.url).origin !== new URL(voiceApiUrl).origin) throw new Error('El servidor devolvió una sesión no válida.');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal.aborted ? 'Conversación cancelada.' : 'La conexión tardó demasiado. Revisá internet e intentá nuevamente.');
    throw error instanceof Error ? error : new Error('No pudimos conectar con Anny.');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}

export async function endVoiceConversation(ticket: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    await fetch(`${voiceApiUrl}/api/end`, { method: 'POST', headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
  } catch { /* The server also expires disconnected sessions. */ }
  finally { clearTimeout(timeout); }
}
