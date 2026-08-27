import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ScreenVoiceAnnouncer } from '@/components/screen-voice-announcer';
import { requestVoicePermissions, speak } from '@/lib/voice';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    async function startVoiceAccess() {
      await speak('Iniciando Anny');

      try {
        await requestVoicePermissions({ showSettingsAlert: true });
      } catch {
        await speak('Necesito permiso de micrófono para escucharte. Podés activarlo desde los permisos de la app.');
      }
    }

    void startVoiceAccess();
  }, []);

  return (
    <ThemeProvider value={DarkTheme}>
      <AnimatedSplashOverlay />
      {/* Lente Bluetooth anterior deshabilitado: se utiliza sólo el lente ESP32. */}
      <ScreenVoiceAnnouncer />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#05070B' },
        }}
      />
    </ThemeProvider>
  );
}
