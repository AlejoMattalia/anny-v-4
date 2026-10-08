import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import {speak} from '../lib/voice';
import type {WifiLensConnection} from '../services/WifiLensConnectionManager';

/** Announce connection attempts once per transition, never background status polls. */
export function useWifiLensAnnouncements(connection: WifiLensConnection) {
  const previous = useRef<WifiLensConnection['phase']>('idle');
  const announcedAttempt = useRef(false);
  const announcementQueue = useRef<Promise<void>>(Promise.resolve());
  const {enabled, phase, target, preference, showDialog} = connection;
  const failure = phase === 'disconnected' ? connection.message : '';
  useEffect(() => {
    const wasAttempting = previous.current === 'searching' || previous.current === 'connecting';
    previous.current = phase;
    const attempting = phase === 'searching' || phase === 'connecting';
    const announceResult = announcedAttempt.current;
    if (attempting) announcedAttempt.current = showDialog;
    else announcedAttempt.current = false;
    if (attempting ? !showDialog : !announceResult) return;
    if (!enabled || AppState.currentState !== 'active') {return;}
    const mode = preference === 'hotspot' ? 'hotspot del celular' : 'WiFi';
    let message = '';
    if (phase === 'searching') {
      message = 'Buscando redes disponibles.';
    } else if (phase === 'connecting') {
      message = `Conectando los lentes a ${target || mode}. Esperá un momento.`;
    } else if (wasAttempting && phase === 'connected') {
      message = `Lentes conectados por ${mode}.`;
    } else if (wasAttempting && phase === 'disconnected' && failure) {
      message = 'No se pudieron conectar los lentes. Podés reintentar desde Dispositivos.';
    }
    if (!message) {return;}
    let cancelled = false;
    // Finish the search announcement before speaking the connection result.
    announcementQueue.current = announcementQueue.current.catch(() => {}).then(() => {
      if (!cancelled && AppState.currentState === 'active') {
        return speak(message);
      }
    }).catch(() => console.warn('[WifiLens] No se pudo reproducir el aviso de conexión.'));
    return () => {cancelled = true;};
  }, [enabled, phase, target, preference, failure, showDialog]);
}
