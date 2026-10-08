import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { WifiLensProvider } from '@/context/wifi-lens-context';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ScreenVoiceAnnouncer } from '@/components/screen-voice-announcer';
import { warmCurrentLocation } from '@/lib/current-location';
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
    void warmCurrentLocation();
  }, []);

  return (
    <ThemeProvider
      value={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: '#3C1642',
          background: '#FCFCFC',
          card: '#FFFFFF',
          text: '#212121',
          border: '#E2DCE4',
          notification: '#6A0DAD',
        },
      }}>
      <WifiLensProvider>
      <AnimatedSplashOverlay />
      <StatusBar style="dark" />
      {/* Placa con activación y Bluetooth Classic deshabilitados. Flujo WiFi de v3. */}
      <ScreenVoiceAnnouncer />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FCFCFC' },
        }}
      />
      </WifiLensProvider>
    </ThemeProvider>
  );
}
