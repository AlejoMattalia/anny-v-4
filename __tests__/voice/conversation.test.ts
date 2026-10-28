import { validateConversationPlan, conversationNeedsConfirmation } from '../../src/services/ConversationActions';
import { createVoiceConversation, endVoiceConversation, voiceApiUrl } from '../../src/lib/voice-conversation';
import { getAuthSession } from '../../src/lib/auth';

jest.mock('../../src/lib/auth', () => ({ getAuthSession: jest.fn() }));
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); global.fetch = fetchMock;
  (getAuthSession as jest.Mock).mockResolvedValue({ access_token: 'user-auth-token' });
});
afterEach(() => jest.useRealTimers());
it('reports a stuck login read instead of showing the loading spinner forever', async () => {
  jest.useFakeTimers();
  (getAuthSession as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  const pending = createVoiceConversation(new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow('leer tu sesión');
  await jest.advanceTimersByTimeAsync(8000); await rejected;
  expect(fetchMock).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
it('uses the Anny login for bootstrap and only accepts a conversation on the trusted origin', async () => {
  const data = { ticket: 'a'.repeat(43), url: voiceApiUrl + '/', maxSessionSeconds: 600, expiresIn: 60 };
  fetchMock.mockResolvedValue({ ok: true, json: async () => data });
  await expect(createVoiceConversation(new AbortController().signal)).resolves.toEqual(data);
  expect(fetchMock).toHaveBeenCalledWith(voiceApiUrl + '/api/bootstrap', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer user-auth-token' }) }));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...data, url: 'https://another-origin.test/' }) });
  await expect(createVoiceConversation(new AbortController().signal)).rejects.toThrow('sesión no válida');
});
it('never opens an unauthenticated conversation and ends using the temporary ticket', async () => {
  (getAuthSession as jest.Mock).mockResolvedValue(null);
  await expect(createVoiceConversation(new AbortController().signal)).rejects.toThrow('Iniciá sesión');
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue({ ok: true }); await endVoiceConversation('temporary-ticket');
  expect(fetchMock).toHaveBeenCalledWith(voiceApiUrl + '/api/end', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer temporary-ticket' }) }));
});
it('rejects forged bridge actions, role escalation and conversation loops', () => {
  const plan = { type: 'native', name: 'execute_anny_command', arguments: { text: 'texto', command: 'texto', action: 'text' } };
  expect(validateConversationPlan(plan, ['PDV'])).toEqual(plan);
  expect(() => validateConversationPlan(plan, ['TUTOR'])).toThrow('permitida');
  expect(() => validateConversationPlan({ ...plan, arguments: { ...plan.arguments, text: 'salir' } }, ['PDV'])).toThrow();
  expect(() => validateConversationPlan({ ...plan, name: 'shell' }, ['PDV'])).toThrow();
  expect(() => validateConversationPlan({ ...plan, arguments: { text: 'conversar', command: 'conversar', action: 'conversation' } }, ['PDV'])).toThrow();
  expect(conversationNeedsConfirmation('help')).toBe(true);
  expect(conversationNeedsConfirmation('wifi')).toBe(true);
  expect(conversationNeedsConfirmation('image')).toBe(false);
});
it('preserves the spoken destination and transport when approving a navigation action', () => {
  const plan = { type: 'native', name: 'execute_anny_command', arguments: { text: 'ir a Hospital Córdoba en colectivo', command: 'ir a', action: 'navigate' } };
  expect(validateConversationPlan(plan, ['PDV']).arguments.text).toBe(plan.arguments.text);
});
