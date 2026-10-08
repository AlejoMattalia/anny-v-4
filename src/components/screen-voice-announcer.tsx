import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { speak } from '@/lib/voice';
import { useWifiLens } from '@/context/wifi-lens-context';

const SCREEN_ANNOUNCEMENTS: Record<string, string> = {
  '/home':
    'Inicio de Anny. Podés elegir Viajar, Explorar, Ayuda o Configuración. También podés abrir el menú para acceder a tu perfil, tutorial y términos de uso.',
  '/help':
    'Sección Ayuda. Podés escanear texto, imágenes y billetes, o abrir el streaming en tiempo real del lente o del celular.',
  '/anny-board':
    'Sección Lente Anny. Podés abrir el streaming en tiempo real de los lentes vinculados a tu cuenta.',
  '/remote-cameras':
    'Streaming de Lente Anny. Podés elegir una cámara vinculada o vincular una nueva con su código de activación.',
  '/explore':
    'Sección Explorar. Podés conocer tu ubicación, explorar el mapa o buscar lugares cercanos.',
  '/visual-scanner':
    'Asistencia visual. Apuntá la cámara y mantené el celular quieto. Anny escanea automáticamente con el intervalo de Configuración y lee el resultado en voz alta. Podés detener la voz o escanear ahora con los botones.',
  '/map-explorer':
    'Explorador de mapa. Podés mover el mapa, escribir el nombre de un lugar, seleccionar marcadores o centrar el mapa en tu ubicación.',
  '/where-am-i':
    'Dónde estoy. Anny buscará tu ubicación actual, leerá la dirección y te permitirá verla en el mapa.',
  '/nearby-places':
    'Lugares cercanos. Anny buscará comercios y servicios próximos. Podés escuchar cada lugar, verlo en el mapa o iniciar un viaje.',
  '/travel':
    'Sección Viajar. Podés planificar un viaje, iniciar un viaje ahora, simular un recorrido, abrir tus viajes guardados o consultar tus ubicaciones.',
  '/plan-trip':
    'Planificación de viaje. Podés elegir origen, destino y modo de transporte. Después podrás guardar el viaje o iniciarlo.',
  '/start-trip':
    'Iniciar viaje. Podés buscar el destino escribiendo, usar el micrófono o elegir un viaje guardado. Anny te guiará por voz durante el recorrido.',
  '/saved-trips':
    'Viajes guardados y favoritos. Podés escuchar los datos de cada viaje, cambiar el modo de transporte, iniciarlo, simularlo o eliminarlo.',
  '/saved-locations':
    'Mis ubicaciones. Podés seleccionar una ubicación guardada, agregar una nueva dirección o eliminar una ubicación.',
  '/contacts':
    'Contactos. Podés recorrer tu agenda, escuchar los datos de un contacto, marcarlo como favorito o llamarlo.',
  '/bluetooth-devices':
    'Dispositivos. Elegí WiFi o Hotspot y conectá una red.',
  '/settings':
    'Configuración. Podés revisar permisos, conexión de anteojos, brújula, velocidad de voz y velocidad de simulación.',
  '/profile':
    'Perfil. Podés revisar tu cuenta, editar tu información personal, abrir otras opciones o cerrar sesión.',
  '/notifications':
    'Notificaciones. Podés revisar el permiso del dispositivo, configurar el aviso anticipado de destino y enviar una notificación de prueba.',
  '/training':
    'Capacitaciones. Elegí un módulo para conocer sus actividades y escuchar cada paso.',
  '/onboarding':
    'Tutorial de Anny. Recorré los pasos y usá el botón Escuchar descripción para oír el contenido completo.',
  '/terms':
    'Términos de uso. En esta página podés consultar las condiciones de uso de Anny.',
};

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
    const announcement = SCREEN_ANNOUNCEMENTS[pathname];

    if (!announcement) {
      return;
    }

    const timeout = setTimeout(() => {
      void speak(announcement);
    }, 250);

    return () => clearTimeout(timeout);
  }, [pathname, connectionDialogOpen]);

  return null;
}
