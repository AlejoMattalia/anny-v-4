import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// Bundled Coral recording: works before the server or microphone is ready.
export function playConversationConnecting(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    let player: AudioPlayer | undefined;
    let listener: { remove: () => void } | undefined;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      try { listener?.remove(); } catch { /* Already released by the OS. */ }
      try { player?.remove(); } catch { /* Startup must still be able to finish. */ }
      resolve();
    };
    const timeout = setTimeout(finish, 5000);
    signal.addEventListener('abort', finish, { once: true });
    try {
      player = createAudioPlayer(require('../../assets/audio/connecting.wav'), { updateInterval: 100, keepAudioSessionActive: false });
      listener = player.addListener('playbackStatusUpdate', status => { if (status.didJustFinish || status.playbackState === 'error') finish(); });
      player.play();
    } catch { finish(); }
  });
}
