import * as Speech from 'expo-speech';
import { relayConversationSpeech, conversationIsActive, isTutorCallActive, type ConversationSpeech } from '@/services/ConversationRuntime';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

import { loadSettings } from '@/lib/settings-storage';
import { streamingDelay, streamingTimeout } from '@/services/StreamingClock';

type ListenOptions = {
  prompt?: string;
  timeoutMs?: number;
  contextualStrings?: string[];
};

let latestSpeechToken = 0;
let spanishVoicePromise: Promise<Speech.Voice | undefined> | undefined;
let cancelActiveListen: (() => void) | undefined;
let listening = false;
let guidancePaused = false;
let lastSpokenText = '';
let listeningGeneration = 0;
let recognitionDrain: Promise<void> = Promise.resolve();
export const getLastSpokenText = () => lastSpokenText;
export const setGuidancePaused = (paused: boolean) => { guidancePaused = paused; };
export async function speakGuidance(text: string) { if (!guidancePaused) await speak(text, { priority: 'guidance' }); }

export async function speak(text: string, options: { onError?: (error: Error) => void; remember?: boolean } & ConversationSpeech = {}) {
  // Screen announcements and camera analyses must not be heard as user commands.
  if (listening || isTutorCallActive()) return;
  if (options.remember !== false) lastSpokenText = text;
  if (await relayConversationSpeech(text, options)) return;
  const speechToken = ++latestSpeechToken;
  await Speech.stop();
  const settings = await loadSettings();
  spanishVoicePromise ??= Speech.getAvailableVoicesAsync().then((voices) => {
    const spanish = voices.filter((voice) => /^es([_-]|$)/i.test(voice.language));
    return spanish.find((voice) => /local/i.test(voice.identifier))
      ?? spanish.find((voice) => /^es[-_]AR$/i.test(voice.language))
      ?? spanish[0];
  }).catch(() => undefined);
  const voice = await spanishVoicePromise;

  if (speechToken !== latestSpeechToken || isTutorCallActive()) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const cancelFallback = streamingTimeout(() => finish(), Math.max(10000, text.length * 150 / (settings.voiceRate || 1)));

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      cancelFallback();
      resolve();
    }

    Speech.speak(text, {
      language: voice?.language ?? 'es',
      voice: voice?.identifier,
      useApplicationAudioSession: false,
      pitch: 1,
      rate: settings.voiceRate,
      onStart: options.onStart,
      onDone: finish,
      onStopped: finish,
      onError: (error) => {
        options.onError?.(error);
        finish();
      },
    });
  });

  if (options.priority !== 'stream') await streamingDelay(250);
}

export async function stopSpeaking() {
  latestSpeechToken += 1;
  await Speech.stop();
}

export async function requestVoicePermissions(options: { showSettingsAlert?: boolean } = {}) {
  // Android requestPermissions can pause/resume the Activity even when the
  // permission is already granted. AppState would then cancel the new listen.
  const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  const permissions = current.granted ? current : await ExpoSpeechRecognitionModule.requestPermissionsAsync();

  if (!permissions.granted) {
    if (options.showSettingsAlert) {
      showMicrophonePermissionAlert();
    }

    throw new Error('Necesito permiso de micrófono para escucharte.');
  }

  return permissions;
}

export async function requestConversationMicrophone() {
  // Realtime uses microphone audio directly, without the OS speech recognizer.
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const granted = await PermissionsAndroid.check(permission) ||
      await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED;
    if (!granted) throw new Error('Permití el acceso al micrófono en los permisos de Anny para conversar.');
    return;
  }
  const current = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync();
  const permission = current.granted ? current : await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
  if (!permission.granted) throw new Error('Permití el acceso al micrófono en los permisos de Anny para conversar.');
}

export async function checkVoicePermissions() {
  const permissions = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  return permissions;
}

export function stopListening() {
  listeningGeneration++;
  const active = cancelActiveListen;
  cancelActiveListen?.();
  // abort() emits an error and an asynchronous end even when idle. Never send
  // those stale events into the next recognition session just to reset state.
  if (active) {
    // Native abort posts its end on Android's main thread. A retry must wait
    // for it before installing the next session's result/error listeners.
    recognitionDrain = new Promise<void>(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer); subscription.remove(); resolve();
      };
      const subscription = ExpoSpeechRecognitionModule.addListener('end', finish);
      const timer = setTimeout(finish, 1500);
      ExpoSpeechRecognitionModule.abort();
    });
  }
}

export async function listenOnce(options: ListenOptions = {}) {
  if (conversationIsActive()) throw new Error('Anny ya está escuchando. Hablá directamente en la conversación.');
  stopListening();
  const generation = listeningGeneration;
  await recognitionDrain;
  await stopSpeaking();
  if (generation !== listeningGeneration) throw new Error('Escucha cancelada.');
  await requestVoicePermissions({ showSettingsAlert: true });
  if (generation !== listeningGeneration) throw new Error('Escucha cancelada.');

  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    throw new Error('El reconocimiento de voz no está disponible en este dispositivo.');
  }
  if (options.prompt) await speak(options.prompt, { remember: false });
  if (generation !== listeningGeneration) throw new Error('Escucha cancelada.');

  return new Promise<string>((resolve, reject) => {
    listening = true;
    let settled = false;
    let started = false;
    let bestTranscript = '';
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('No escuché ninguna respuesta. Probá de nuevo.')));
      ExpoSpeechRecognitionModule.abort();
    }, options.timeoutMs ?? 12000);

    const subscriptions = [
      ExpoSpeechRecognitionModule.addListener('start', () => { started = true; }),
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        const transcript = event.results[0]?.transcript?.trim();

        if (transcript) {
          bestTranscript = transcript;
        }

        if (event.isFinal && bestTranscript) {
          finish(() => resolve(bestTranscript));
        }
      }),
      ExpoSpeechRecognitionModule.addListener('nomatch', () => {
        finish(() => reject(new Error('No pude entenderte. Intentá hablar más claro.')));
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        if (event.error === 'aborted') {
          if (!started) return; // A previous recognizer is still finishing abort().
          finish(() => reject(new Error('Se interrumpió el micrófono. Tocá para volver a escuchar.')));
          return;
        }

        finish(() => reject(new Error(getSpeechErrorMessage(event.error))));
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (!started && !bestTranscript) return; // Not this session's end.
        if (bestTranscript) {
          finish(() => resolve(bestTranscript));
        } else finish(() => reject(new Error('No escuché ninguna respuesta. Probá de nuevo.')));
      }),
    ];

    function finish(callback: () => void) {
      if (settled) {
        return;
      }

      settled = true;
      listening = false;
      cancelActiveListen = undefined;
      clearTimeout(timeout);
      subscriptions.forEach((subscription) => subscription.remove());
      callback();
    }

    cancelActiveListen = () => finish(() => reject(new Error('Escucha cancelada.')));
    try { ExpoSpeechRecognitionModule.start({
      lang: 'es-AR',
      interimResults: true,
      continuous: false,
      contextualStrings: options.contextualStrings,
      addsPunctuation: false,
    }); } catch (error) { finish(() => reject(error)); }
  });
}

export function normalizeSpokenEmail(transcript: string) {
  return transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+arroba\s+/g, '@')
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+punto\s+/g, '.')
    .replace(/\s+guion bajo\s+/g, '_')
    .replace(/\s+guion medio\s+/g, '-')
    .replace(/\s+guion\s+/g, '-')
    .replace(/\s+/g, '')
    .replace(/,/g, '.');
}

export function normalizeSpokenPassword(transcript: string) {
  return transcript.replace(/\s+/g, '');
}

function getSpeechErrorMessage(error: string) {
  if (error === 'not-allowed') {
    return 'Necesito permiso de micrófono para escucharte.';
  }

  if (error === 'no-speech' || error === 'speech-timeout') {
    return 'No escuché ninguna respuesta. Probá de nuevo.';
  }

  if (error === 'network') {
    return 'Hubo un problema de conexión con el reconocimiento de voz.';
  }

  if (error === 'busy') {
    return 'El micrófono está ocupado. Probá de nuevo en unos segundos.';
  }

  return 'No pude escucharte. Probá de nuevo.';
}

function showMicrophonePermissionAlert() {
  Alert.alert(
    'Activar micrófono',
    'Anny necesita permiso de micrófono y reconocimiento de voz para poder escucharte. Podés activarlo desde los ajustes de la app.',
    [
      {
        text: 'Ahora no',
        style: 'cancel',
      },
      {
        text: 'Abrir ajustes',
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ],
  );
}
