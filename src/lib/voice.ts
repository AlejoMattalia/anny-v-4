import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Alert, Linking } from 'react-native';

import { loadSettings } from '@/lib/settings-storage';

type ListenOptions = {
  prompt?: string;
  timeoutMs?: number;
  contextualStrings?: string[];
};

let latestSpeechToken = 0;

export async function speak(text: string) {
  const speechToken = ++latestSpeechToken;
  await Speech.stop();
  const settings = await loadSettings();

  if (speechToken !== latestSpeechToken) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const fallbackTimeout = setTimeout(() => finish(), Math.max(2500, text.length * 95));

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(fallbackTimeout);
      resolve();
    }

    Speech.speak(text, {
      language: 'es-AR',
      pitch: 1,
      rate: settings.voiceRate,
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  });

  await wait(250);
}

export async function stopSpeaking() {
  latestSpeechToken += 1;
  await Speech.stop();
}

export async function requestVoicePermissions(options: { showSettingsAlert?: boolean } = {}) {
  const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

  if (!permissions.granted) {
    if (options.showSettingsAlert) {
      showMicrophonePermissionAlert();
    }

    throw new Error('Necesito permiso de micrófono para escucharte.');
  }

  return permissions;
}

export async function checkVoicePermissions() {
  const permissions = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  return permissions;
}

export function stopListening() {
  ExpoSpeechRecognitionModule.abort();
}

export async function listenOnce(options: ListenOptions = {}) {
  if (options.prompt) {
    await speak(options.prompt);
  }

  await requestVoicePermissions({ showSettingsAlert: true });

  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    throw new Error('El reconocimiento de voz no está disponible en este dispositivo.');
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let bestTranscript = '';
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('No escuché ninguna respuesta. Probá de nuevo.')));
      ExpoSpeechRecognitionModule.abort();
    }, options.timeoutMs ?? 12000);

    const subscriptions = [
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
          finish(() => reject(new Error('Escucha cancelada.')));
          return;
        }

        finish(() => reject(new Error(getSpeechErrorMessage(event.error))));
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (bestTranscript) {
          finish(() => resolve(bestTranscript));
        }
      }),
    ];

    function finish(callback: () => void) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      subscriptions.forEach((subscription) => subscription.remove());
      callback();
    }

    ExpoSpeechRecognitionModule.start({
      lang: 'es-AR',
      interimResults: true,
      continuous: false,
      contextualStrings: options.contextualStrings,
      addsPunctuation: false,
    });
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
