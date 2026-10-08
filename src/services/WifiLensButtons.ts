import {lensRequest} from './LocalWifiLens';
import type {LensPairing} from './LocalWifiLens';

type VoiceButton = {
  fault: 'none' | 'stuck_input' | 'conflicting_buttons';
  boot_id: number;
  presses: number;
  last_press_age_ms: number | null;
};

const uint32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

function readVoiceButton(value: any): VoiceButton {
  const voice = value?.voice;
  if (voice?.ready !== true || !uint32(voice.boot_id) || !uint32(voice.presses) ||
      voice.event_mode !== 'validated_click' ||
      !['none', 'stuck_input', 'conflicting_buttons'].includes(voice.fault) ||
      !(voice.last_press_age_ms === null || uint32(voice.last_press_age_ms))) {
    throw new Error('El botón de voz requiere firmware 2.4.5 o posterior.');
  }
  return voice;
}

/** Poll stored press counters so a short click is still seen after release. */
export function watchWifiLensButtons(pair: LensPairing, onPress: () => void): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: VoiceButton | null = null;
  let failures = 0;

  const poll = async () => {
    let nextPollMs = 300;
    const started = Date.now();
    try {
      const response = await lensRequest(pair.address, pair.password, '/api/buttons', undefined, 1800, controller.signal);
      if (controller.signal.aborted) {return;}
      const current = readVoiceButton(response);
      failures = 0;
      // An input fault is a valid response, not a broken Wi-Fi connection.
      // Keep checking for release instead of delaying recovery by 15 seconds.
      if (current.fault !== 'none') {
        previous = null;
        return;
      }
      const count = previous?.boot_id === current.boot_id
        ? (current.presses - previous.presses + 0x100000000) % 0x100000000 : 0;
      // Baseline on initial connection, reboot, or recovery. Never replay an
      // old click when returning to Anny or reconnecting to a lens.
      previous = current;
      // A burst must never toggle the microphone repeatedly. Consume it as a
      // new baseline and wait for a single fresh, validated click.
      if (count === 1 && current.last_press_age_ms !== null &&
          current.last_press_age_ms + Date.now() - started <= 2000) {
        onPress();
      }
    } catch (error) {
      if (controller.signal.aborted) {return;}
      previous = null;
      if (++failures === 1) {
        console.warn('[WifiLensButtons]', error instanceof Error ? error.message : 'No se pudo consultar el botón.');
      }
      nextPollMs = failures === 1 ? 2000 : failures === 2 ? 5000 : 15000;
    } finally {
      if (!controller.signal.aborted) {timer = setTimeout(poll, nextPollMs);}
    }
  };

  poll();
  return () => {
    controller.abort();
    if (timer !== undefined) {clearTimeout(timer);}
  };
}
