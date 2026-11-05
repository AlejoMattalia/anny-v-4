import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { conversationIsActive } from '@/services/ConversationRuntime';
import { speak } from '@/lib/voice';
import { useWifiLens } from '@/context/wifi-lens-context';

const HOME_ANNOUNCEMENT =
  'Inicio de Anny. Podés elegir Viajar, Explorar, Ayuda o Configuración. Para usar comandos de voz, tocá el micrófono de la barra inferior. El botón de tus lentes activa la IA. Decí comandos para conocer las opciones. El menú permite acceder a tu perfil, tutorial y términos de uso.';

export function ScreenVoiceAnnouncer() {
  const pathname = usePathname();
  const { wifiLensConnection } = useWifiLens();
  const connectionDialogOpen = wifiLensConnection.showDialog;
  const announcedPath = useRef<string | null>(null);

  useEffect(() => {
    if (announcedPath.current === pathname) return;
    announcedPath.current = pathname;
    // The visible connection dialog owns the startup announcement.
    if (connectionDialogOpen) return;
    if (pathname !== '/home' || conversationIsActive()) {
      return;
    }

    const timeout = setTimeout(() => {
      void speak(HOME_ANNOUNCEMENT);
    }, 250);

    return () => clearTimeout(timeout);
  }, [pathname, connectionDialogOpen]);

  return null;
}
