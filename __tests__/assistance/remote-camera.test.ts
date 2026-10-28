import { parseRemoteCameraMessage, remoteCameraFeed, remoteCameraMessage } from '../../src/lib/assistance-remote-camera';

const cameraId = 'camera_aabbccddeeff';
const streamUrl = `https://video.example/webrtc/${cameraId}/?token=temporary`;

it('shares only the temporary player session, preserving the original server URL', () => {
  const camera = remoteCameraFeed(cameraId, { streamUrl, expiresIn: 300 });
  expect(camera.expiresAt).toBeGreaterThan(Date.now() + 299000);
  expect(parseRemoteCameraMessage(remoteCameraMessage(camera))).toEqual(camera);
});

it('rejects malformed, expired or non-playback messages', () => {
  const valid = remoteCameraFeed(cameraId, { streamUrl, expiresIn: 300 });
  for (const change of [
    { expiresAt: Date.now() - 1 }, { cameraId: 'different-camera' }, { streamUrl: 'javascript:alert(1)' },
    { streamUrl: streamUrl.replace(cameraId, 'camera_000000000000') },
    { streamUrl: streamUrl.split('?')[0] }, { streamUrl: streamUrl.replace('https://', 'https://user:password@') },
  ]) expect(parseRemoteCameraMessage(remoteCameraMessage({ ...valid, ...change }))).toBeNull();
  expect(parseRemoteCameraMessage('SHOW_GLASSES')).toBeNull();
  expect(parseRemoteCameraMessage('null')).toBeNull();
});
