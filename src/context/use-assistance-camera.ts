import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistanceRole } from '../lib/assistance-api';
import { remoteCameraFeed, type AssistanceRemoteCamera } from '../lib/assistance-remote-camera';
import { createCameraViewSession, getRemoteCameras, streamingApiUrl } from '../lib/remote-cameras';

/** The PDV chooses its camera; the tutor receives the same server playback URL. */
export function useAssistanceCamera({ role, callId, localAvailable, foreground }: {
  role: AssistanceRole | null; callId?: string; localAvailable: boolean; foreground: boolean;
}) {
  const [glasses, setGlasses] = useState(role === 'PDV' && localAvailable);
  const [remoteCamera, setRemoteCamera] = useState<AssistanceRemoteCamera | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const current = useRef({ localAvailable, remoteCamera });
  useEffect(() => { current.current = { localAvailable, remoteCamera }; }, [localAvailable, remoteCamera]);
  const invalidate = useCallback(() => { revision.current++; }, []);

  const selectSource = useCallback(async (next: boolean) => {
    const request = ++revision.current;
    setNotice('');
    if (!next || role !== 'PDV') {
      setChoosing(false); setRemoteCamera(null); setGlasses(next);
      return;
    }
    setChoosing(true);
    try {
      if (streamingApiUrl) {
        const cameras = (await getRemoteCameras()).filter(camera => camera.enabled && camera.online);
        if (request !== revision.current) return;
        const selected = cameras.find(camera => camera.id === current.current.remoteCamera?.cameraId) ?? cameras[0];
        if (selected) {
          const session = await createCameraViewSession(selected.id);
          if (request !== revision.current) return;
          setRemoteCamera(remoteCameraFeed(selected.id, session)); setGlasses(true);
          return;
        }
      }
    } catch {
      if (request !== revision.current) return;
      setNotice('No se pudo abrir el lente del servidor.');
    } finally {
      if (request === revision.current) setChoosing(false);
    }
    if (request !== revision.current) return;
    setRemoteCamera(null); setGlasses(current.current.localAvailable);
    if (!current.current.localAvailable) setNotice('Lente del servidor no disponible. Usando cámara del celular.');
  }, [role]);

  useEffect(() => {
    let active = true;
    if (callId && role === 'PDV') queueMicrotask(() => { if (active) void selectSource(true); });
    return () => { active = false; invalidate(); };
  }, [callId, role, selectSource, invalidate]);

  // Renew access before expiry, including after a long time in the background.
  // Players keep their active WebRTC connection; the new URL is used on retry.
  useEffect(() => {
    if (role !== 'PDV' || !remoteCamera || !foreground) return;
    const request = revision.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const renew = async () => {
      try {
        const session = await createCameraViewSession(remoteCamera.cameraId);
        if (!cancelled && request === revision.current) {
          setRemoteCamera(remoteCameraFeed(remoteCamera.cameraId, session));
        }
      } catch {
        if (!cancelled && request === revision.current) timer = setTimeout(() => void renew(), 10000);
      }
    };
    timer = setTimeout(() => void renew(), Math.max(0, remoteCamera.expiresAt - Date.now() - 60000));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [role, remoteCamera, foreground]);

  const receiveRemoteCamera = useCallback((camera: AssistanceRemoteCamera) => {
    if (role !== 'TUTOR') return;
    setRemoteCamera(camera); setGlasses(true); setNotice('');
  }, [role]);

  return { glasses, remoteCamera, choosing, notice, selectSource, receiveRemoteCamera };
}
