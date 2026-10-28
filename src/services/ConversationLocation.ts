import { getCurrentLocation, type CurrentLocation } from '../lib/current-location';
import { conversationDeadline } from './ConversationStartup';

export function reliableConversationLocation(location: CurrentLocation, now = Date.now()) {
  return Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
    Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 &&
    location.accuracy != null && Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= 50 &&
    Number.isFinite(location.timestamp) && now - location.timestamp >= -5000 && now - location.timestamp <= 30000;
}

export async function getConversationLocation(signal?: AbortSignal): Promise<CurrentLocation> {
  if (signal?.aborted) throw new Error('Conversación cancelada.');
  const message = 'Todavía no tengo una ubicación GPS reciente y precisa. ¿En qué calle y altura estás? También podés activar la ubicación precisa y volver a intentar. No voy a elegir un origen aproximado.';
  const read = (allowCached: boolean) => conversationDeadline(getCurrentLocation({ allowCached, highAccuracy: true, maxCachedAgeMs: 15000, maxCachedAccuracyMeters: 50 }), 20000, message, signal);
  const first = await read(true);
  if (reliableConversationLocation(first)) return first;
  if (signal?.aborted) throw new Error('Conversación cancelada.');
  const fresh = await read(false);
  if (reliableConversationLocation(fresh)) return fresh;
  throw new Error(message);
}
