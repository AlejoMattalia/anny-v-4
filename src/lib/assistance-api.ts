import { appApiUrl } from './api';
import { getAuthSession, type AuthUser } from './auth';

const notificationUrl = process.env.EXPO_PUBLIC_APP_API_URL_PORT?.replace(/\/$/, '') || `${appApiUrl}/api`;
const groupUrl = process.env.EXPO_PUBLIC_APP_API_URL_TWO?.replace(/\/$/, '') || `${appApiUrl}/api`;
export const assistanceVideoUrl = process.env.EXPO_PUBLIC_APP_API_URL_GLASSES?.replace(/\/$/, '') || '';

export type AssistanceRole = 'PDV' | 'TUTOR';
export type HelpRequest = {
  _id: string;
  name?: string;
  email?: string;
  currentLocation: { latitude: number; longitude: number };
};
export type AssistanceCall = { idPdv: string; idTutor: string; streamPort: number; streamCode: string };
export type LinkedUser = AuthUser & { _id: string; phone?: string; code?: string };

export function assistanceRole(user?: AuthUser | null): AssistanceRole | null {
  if (user?.roles?.some(role => role.name === 'TUTOR')) return 'TUTOR';
  if (user?.roles?.some(role => role.name === 'PDV')) return 'PDV';
  return null;
}

export function parseCameraResponse(data: unknown, userId: string): AssistanceCall | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const port = Number(value.streamPort);
  if (value.idPdv !== userId || typeof value.idTutor !== 'string' || !value.idTutor ||
      !Number.isInteger(port) || port <= 0 || port > 65535 ||
      typeof value.streamCode !== 'string' || !value.streamCode) return null;
  return { idPdv: userId, idTutor: value.idTutor, streamPort: port, streamCode: value.streamCode };
}

export async function assistanceRequest<T>(base: string, path: string, body?: unknown, signal?: AbortSignal, authenticated = true): Promise<T> {
  if (!base || base === '/api') throw new Error('Falta configurar el servidor de asistencia.');
  const session = authenticated ? await getAuthSession() : null;
  if (authenticated && !session?.access_token) throw new Error('Iniciá sesión para usar la asistencia.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 10000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || data?.success === false || data?.status === false) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'No se pudo completar la solicitud de asistencia.');
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Solicitud cancelada.' : 'La conexión tardó demasiado. Intentá nuevamente.');
    }
    if (error instanceof TypeError || error instanceof SyntaxError) {
      throw new Error('No pudimos conectar con el servidor de asistencia. Revisá tu conexión e intentá nuevamente.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const requestTutorHelp = (_id: string, currentLocation: HelpRequest['currentLocation'], signal?: AbortSignal) =>
  assistanceRequest(notificationUrl, '/notification/help', { _id, currentLocation }, signal);
export const respondToHelp = (idPdv: string, idTutor: string, accepted: boolean) =>
  assistanceRequest(notificationUrl, `/notification/help-${accepted ? 'accepted' : 'ignored'}`, { idPdv, idTutor });
export const finishHelp = (_id: string) => assistanceRequest(notificationUrl, '/notification/finalize-help', { _id });
export const getPendingCamera = (signal?: AbortSignal) =>
  assistanceRequest<{ pending?: AssistanceCall }>(notificationUrl, '/notification/pending-camera', undefined, signal);
export const releaseAssistanceCamera = (call: AssistanceCall) =>
  // The legacy video service authenticates this operation by its reservation
  // code, so cleanup must still work after the application session is cleared.
  assistanceRequest(assistanceVideoUrl, '/stop_streaming_listening', { port: call.streamPort, code: call.streamCode }, undefined, false);

export async function startAssistanceCall(idPdv: string, idTutor: string): Promise<AssistanceCall> {
  if (!(await getAuthSession())?.access_token) throw new Error('Iniciá sesión para usar la asistencia.');
  const reservation = await assistanceRequest<{ port: number; reservation_code: string }>(
    assistanceVideoUrl, '/start_streaming_listening', { show_detection: false }, undefined, false);
  const call = parseCameraResponse({ idPdv, idTutor, streamPort: reservation.port, streamCode: reservation.reservation_code }, idPdv);
  if (!call) throw new Error('El servidor no devolvió una reserva de video válida.');
  try {
    await assistanceRequest(notificationUrl, '/notification/response-camera', call);
    return call;
  } catch (error) {
    await releaseAssistanceCamera(call).catch(() => undefined);
    throw error;
  }
}

export const sendAssistanceFrame = (call: AssistanceCall, image: string, signal: AbortSignal) =>
  assistanceRequest(assistanceVideoUrl, `/frame/${call.streamPort}`, { image: image.replace(/^data:image\/jpeg;base64,/, '') }, signal, false);
export async function listLinkedUsers(_id: string): Promise<LinkedUser[]> {
  const data = await assistanceRequest<{ docs: LinkedUser[] }>(groupUrl, `/group/list-mobile?_id=${encodeURIComponent(_id)}`);
  return (data.docs || []).filter(user => user._id !== _id);
}
export const addLinkedUser = (_id: string, roleOfSender: AssistanceRole, email: string) =>
  assistanceRequest<boolean>(groupUrl, '/group/add-user-chat', { _id, roleOfSender, email: email.trim() });
export const removeLinkedUser = (_id: string, idToRemove: string) =>
  assistanceRequest(groupUrl, '/group/remove-user-chat', { _id, idToRemove });
export const renameLinkedUser = (userId: string, name: string) =>
  assistanceRequest(groupUrl, '/group/update-user', { userId, name: name.trim() });
export async function inviteTutor(name: string, email: string) {
  const roles = await assistanceRequest<{ docs: { _id: string; name: string }[] }>(`${appApiUrl}/api`, '/role?page=1&limit=100');
  const tutor = roles.docs.find(role => role.name === 'TUTOR');
  if (!tutor) throw new Error('No se encontró el rol de tutor.');
  return assistanceRequest(`${appApiUrl}/api`, '/user/invitation', { name: name.trim(), email: email.trim(), roles: [tutor._id] });
}
