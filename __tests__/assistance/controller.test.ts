import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AssistanceProvider, useAssistance } from '../../src/context/assistance-context';
import { getAuthSession, subscribeAuthSession } from '../../src/lib/auth';
import { getPendingCamera, releaseAssistanceCamera, requestTutorHelp, respondToHelp, startAssistanceCall } from '../../src/lib/assistance-api';
import { subscribeAssistancePush } from '../../src/lib/assistance-push';
import { getCurrentLocation } from '../../src/lib/current-location';
import { router } from 'expo-router';
import { stopListening, stopSpeaking } from '../../src/lib/voice';
import { isTutorCallActive } from '../../src/services/ConversationRuntime';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() }, AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../src/lib/auth', () => ({ getAuthSession: jest.fn(), subscribeAuthSession: jest.fn(() => jest.fn()) }));
jest.mock('../../src/lib/current-location', () => ({ getCurrentLocation: jest.fn() }));
jest.mock('../../src/lib/voice', () => ({ speak: jest.fn().mockResolvedValue(undefined), stopListening: jest.fn(), stopSpeaking: jest.fn() }));
jest.mock('../../src/lib/assistance-push', () => ({ identifyAssistanceUser: jest.fn().mockResolvedValue(undefined), subscribeAssistancePush: jest.fn(() => jest.fn()) }));
jest.mock('../../src/lib/assistance-api', () => ({
  ...jest.requireActual('../../src/lib/assistance-api'),
  requestTutorHelp: jest.fn(), getPendingCamera: jest.fn(), respondToHelp: jest.fn(), startAssistanceCall: jest.fn(),
  releaseAssistanceCamera: jest.fn().mockResolvedValue({}), finishHelp: jest.fn().mockResolvedValue({}),
}));

let state: ReturnType<typeof useAssistance>;
let tree: ReactTestRenderer;
let receive: (data: unknown) => void;
const call = { idPdv: 'pdv', idTutor: 'tutor', streamPort: 50000, streamCode: 'code' };
function Probe() { state = useAssistance(); return null; }
async function mount(role = 'PDV') {
  (getAuthSession as jest.Mock).mockResolvedValue({ access_token: 'token', user: { _id: role === 'PDV' ? 'pdv' : 'tutor', roles: [{ name: role }] } });
  await act(async () => { tree = create(React.createElement(AssistanceProvider, null, React.createElement(Probe))); });
  receive = (subscribeAssistancePush as jest.Mock).mock.calls.at(-1)[0];
}
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (getCurrentLocation as jest.Mock).mockResolvedValue({ latitude: -31, longitude: -64 });
  (requestTutorHelp as jest.Mock).mockResolvedValue({ success: true });
  (getPendingCamera as jest.Mock).mockResolvedValue({});
  (respondToHelp as jest.Mock).mockResolvedValue({ success: true });
  (startAssistanceCall as jest.Mock).mockResolvedValue(call);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); jest.useRealTimers(); });

it('opens one call when both polling and push deliver the same answer', async () => {
  await mount();
  await act(async () => { await state.request(); });
  expect(state.phase).toBe('waiting');
  await act(async () => { receive({ ...call, type: 'responseCamera' }); receive({ ...call, type: 'responseCamera' }); });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(state.call).toEqual(call);
  expect(isTutorCallActive()).toBe(true);
  expect(stopListening).toHaveBeenCalled(); expect(stopSpeaking).toHaveBeenCalled();
  await act(async () => { await state.endCall(); });
  expect(isTutorCallActive()).toBe(false);
  expect(releaseAssistanceCamera).toHaveBeenCalledWith(call);
});
it('ignores late push after cancellation and stops polling', async () => {
  await mount();
  await act(async () => { await state.request(); });
  await act(async () => { state.cancel(); receive({ ...call, type: 'responseCamera' }); jest.advanceTimersByTime(70000); });
  expect(state.phase).toBe('idle'); expect(router.push).not.toHaveBeenCalled();
  expect(getPendingCamera).toHaveBeenCalledTimes(1);
});
it('cannot send a help request after cancellation during GPS acquisition', async () => {
  let resolve!: (value: unknown) => void;
  (getCurrentLocation as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  await mount();
  let request!: ReturnType<typeof state.request>;
  await act(async () => { request = state.request(); });
  await act(async () => { state.cancel(); resolve({ latitude: 1, longitude: 1 }); await request; });
  expect(requestTutorHelp).not.toHaveBeenCalled(); expect(state.phase).toBe('idle');
});
it('lets a tutor accept the PDV location and initiate the v3 video flow', async () => {
  await mount('TUTOR');
  await act(async () => { receive({ type: 'help', _id: 'pdv', name: 'Ana', currentLocation: { latitude: 1, longitude: 2 } }); });
  expect(state.incoming?._id).toBe('pdv');
  await act(async () => { await state.respond(true); await state.startCall(); });
  expect(respondToHelp).toHaveBeenCalledWith('pdv', 'tutor', true);
  expect(startAssistanceCall).toHaveBeenCalledWith('pdv', 'tutor');
  expect(state.call).toEqual(call);
});
it('releases a reservation that completes after logout instead of opening a call', async () => {
  let resolve!: (value: unknown) => void;
  (startAssistanceCall as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  await mount('TUTOR');
  await act(async () => { receive({ type: 'help', _id: 'pdv', currentLocation: { latitude: 1, longitude: 2 } }); await state.respond(true); });
  let request!: ReturnType<typeof state.startCall>;
  await act(async () => { request = state.startCall(); });
  (getAuthSession as jest.Mock).mockResolvedValue(null);
  await act(async () => { (subscribeAuthSession as jest.Mock).mock.calls.at(-1)[0](); });
  await act(async () => { resolve(call); await request; });
  expect(router.push).not.toHaveBeenCalled(); expect(releaseAssistanceCamera).toHaveBeenCalledWith(call);
});

it('preserves a notification received while restoring the tutor session', async () => {
  let resolve!: (session: unknown) => void;
  (getAuthSession as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => { tree = create(React.createElement(AssistanceProvider, null, React.createElement(Probe))); });
  receive = (subscribeAssistancePush as jest.Mock).mock.calls.at(-1)[0];
  await act(async () => {
    receive({ type: 'help', _id: 'pdv', name: 'Ana', currentLocation: { latitude: 1, longitude: 2 } });
    resolve({ access_token: 'token', user: { _id: 'tutor', roles: [{ name: 'TUTOR' }] } });
  });
  expect(state.incoming?._id).toBe('pdv');
});
it('does not replace an accepted request with a different PDV', async () => {
  await mount('TUTOR');
  await act(async () => { receive({ type: 'help', _id: 'pdv', currentLocation: { latitude: 1, longitude: 2 } }); await state.respond(true); });
  await act(async () => { receive({ type: 'help', _id: 'other', currentLocation: { latitude: 3, longitude: 4 } }); await state.startCall(); });
  expect(startAssistanceCall).toHaveBeenCalledWith('pdv', 'tutor');
});
it('expires unanswered requests without leaving an active polling loop', async () => {
  await mount();
  await act(async () => { await state.request(); });
  await act(async () => { jest.advanceTimersByTime(65000); });
  expect(state.phase).toBe('idle');
  const polls = (getPendingCamera as jest.Mock).mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(65000); });
  expect(getPendingCamera).toHaveBeenCalledTimes(polls);
});
