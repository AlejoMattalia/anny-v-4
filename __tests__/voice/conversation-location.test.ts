import { getCurrentLocation } from '../../src/lib/current-location';
import { getConversationLocation, reliableConversationLocation } from '../../src/services/ConversationLocation';
jest.mock('../../src/lib/current-location', () => ({ getCurrentLocation: jest.fn() }));
const fix = (extra = {}) => ({ latitude: -33.123, longitude: -64.349, accuracy: 12, timestamp: Date.now(), ...extra });
beforeEach(() => jest.clearAllMocks());
it.each([{ accuracy: null }, { accuracy: 1000 }, { accuracy: -1 }, { accuracy: NaN }, { latitude: NaN }, { longitude: 181 }, { timestamp: 0 }, { timestamp: Date.now() + 60000 }])('rejects unusable location information: %p', values => {
  expect(reliableConversationLocation(fix(values))).toBe(false);
});
it('refreshes an approximate reading and accepts only the precise new GPS fix', async () => {
  (getCurrentLocation as jest.Mock).mockResolvedValueOnce(fix({ accuracy: 600 })).mockResolvedValueOnce(fix());
  await expect(getConversationLocation()).resolves.toMatchObject({ accuracy: 12 });
  expect(getCurrentLocation).toHaveBeenNthCalledWith(2, expect.objectContaining({ allowCached: false, highAccuracy: true }));
});
it('asks for clarification after repeated imprecise fixes instead of returning coordinates to use', async () => {
  (getCurrentLocation as jest.Mock).mockResolvedValue(fix({ accuracy: 800 }));
  await expect(getConversationLocation()).rejects.toThrow('¿En qué calle y altura estás?');
  expect(getCurrentLocation).toHaveBeenCalledTimes(2);
});
it('does not request GPS after the user ends the conversation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(getConversationLocation(controller.signal)).rejects.toThrow('cancelada');
  expect(getCurrentLocation).not.toHaveBeenCalled();
});
