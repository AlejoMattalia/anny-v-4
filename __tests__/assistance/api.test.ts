jest.mock('../../src/lib/auth', () => ({ getAuthSession: jest.fn().mockResolvedValue({ access_token: 'session', user: { _id: 'pdv' } }) }));
jest.mock('../../src/lib/api', () => ({ appApiUrl: 'https://api.example' }));

import { getAuthSession } from '../../src/lib/auth';
import { addLinkedUser, assistanceRole, parseCameraResponse, releaseAssistanceCamera, requestTutorHelp, startAssistanceCall } from '../../src/lib/assistance-api';

const mockFetch = jest.fn();
beforeEach(() => {
  global.fetch = mockFetch; mockFetch.mockReset();
  (getAuthSession as jest.Mock).mockResolvedValue({ access_token: 'session', user: { _id: 'pdv' } });
});
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

it('uses the real role even when TUTOR is not the first role', () => {
  expect(assistanceRole({ roles: [{ name: 'user' }, { name: 'TUTOR' }] })).toBe('TUTOR');
  expect(assistanceRole({ roles: [{ name: 'PDV' }] })).toBe('PDV');
  expect(assistanceRole({ roles: [] })).toBeNull();
});
it('does not accept another account or an invalid camera reservation', () => {
  const call = { idPdv: 'pdv', idTutor: 'tutor', streamPort: '50000', streamCode: 'code' };
  expect(parseCameraResponse(call, 'pdv')?.streamPort).toBe(50000);
  expect(parseCameraResponse(call, 'someone-else')).toBeNull();
  expect(parseCameraResponse({ ...call, streamPort: -1 }, 'pdv')).toBeNull();
  expect(parseCameraResponse({ ...call, streamCode: '' }, 'pdv')).toBeNull();
});
it('sends the v3 location payload with the signed-in session', async () => {
  mockFetch.mockResolvedValue(response({ success: true }));
  await requestTutorHelp('pdv', { latitude: -31.4, longitude: -64.2 });
  expect(mockFetch).toHaveBeenCalledWith('https://api.example/api/notification/help', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer session' }),
    body: JSON.stringify({ _id: 'pdv', currentLocation: { latitude: -31.4, longitude: -64.2 } }),
  }));
});
it('preserves false from add-user-chat so the UI can offer an invitation', async () => {
  mockFetch.mockResolvedValue(response(false));
  await expect(addLinkedUser('pdv', 'PDV', ' tutor@example.com ')).resolves.toBe(false);
});
it('never calls a backend without a session', async () => {
  (getAuthSession as jest.Mock).mockResolvedValue(null);
  await expect(requestTutorHelp('pdv', { latitude: 0, longitude: 0 })).rejects.toThrow('Iniciá sesión');
  expect(mockFetch).not.toHaveBeenCalled();
});
it('releases the reserved camera if notifying the other account fails', async () => {
  // Configure this module's video base before loading it in isolation.
  process.env.EXPO_PUBLIC_APP_API_URL_GLASSES = 'https://video.example';
  jest.resetModules();
  const isolated = require('../../src/lib/assistance-api') as { startAssistanceCall: typeof startAssistanceCall; releaseAssistanceCamera: typeof releaseAssistanceCamera };
  mockFetch.mockResolvedValueOnce(response({ status: true, port: 50000, reservation_code: 'code' }))
    .mockResolvedValueOnce(response({ success: false, message: 'PDV no disponible' }))
    .mockResolvedValueOnce(response({ status: true }));
  await expect(isolated.startAssistanceCall('pdv', 'tutor')).rejects.toThrow('PDV no disponible');
  expect(mockFetch).toHaveBeenLastCalledWith('https://video.example/stop_streaming_listening', expect.objectContaining({ body: JSON.stringify({ port: 50000, code: 'code' }) }));
  const isolatedAuth = require('../../src/lib/auth') as { getAuthSession: jest.Mock };
  isolatedAuth.getAuthSession.mockResolvedValue(null);
  mockFetch.mockResolvedValue(response({ status: true }));
  await isolated.releaseAssistanceCamera({ idPdv: 'pdv', idTutor: 'tutor', streamPort: 50000, streamCode: 'code' });
  expect(mockFetch).toHaveBeenLastCalledWith('https://video.example/stop_streaming_listening', expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }));
  delete process.env.EXPO_PUBLIC_APP_API_URL_GLASSES;
});
