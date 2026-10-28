import type { CameraViewSession } from './remote-cameras';

// Read-only, short-lived playback access, shared only inside the active call.
export type AssistanceRemoteCamera = {
  cameraId: string;
  streamUrl: string;
  expiresAt: number;
};
const MESSAGE_TYPE = 'ANNY_REMOTE_CAMERA_V1';

export function remoteCameraFeed(cameraId: string, session: CameraViewSession): AssistanceRemoteCamera {
  return { cameraId, streamUrl: session.streamUrl, expiresAt: Date.now() + session.expiresIn * 1000 };
}

export function remoteCameraMessage(camera: AssistanceRemoteCamera) {
  return JSON.stringify({ type: MESSAGE_TYPE, ...camera });
}

export function parseRemoteCameraMessage(text: string): AssistanceRemoteCamera | null {
  try {
    if (text.length > 8192) return null;
    const value = JSON.parse(text);
    if (value?.type !== MESSAGE_TYPE || typeof value.cameraId !== 'string' ||
        !/^camera_[a-f0-9]{12}$/.test(value.cameraId) || typeof value.streamUrl !== 'string' ||
        !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    const url = new URL(value.streamUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        !url.pathname.endsWith(`/${value.cameraId}/`) || !url.searchParams.get('token')) return null;
    return { cameraId: value.cameraId, streamUrl: value.streamUrl, expiresAt: value.expiresAt };
  } catch { return null; }
}
