import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { speak } from '@/lib/voice';

const SCREEN_ANNOUNCEMENTS: Record<string, string> = {
  '/home':
    'Inicio de Anny. Podés elegir Viajar, Explorar, Ayuda o Configuración. También podés abrir el menú para acceder a tu perfil, tutorial y términos de uso.',
  '/help':
    'Sección Ayuda. Podés abrir el streaming en tiempo real de los lentes Anny vinculados a tu cuenta.',
  '/anny-board':
    'Sección Lente Anny. Podés abrir el streaming en tiempo real de los lentes vinculados a tu cuenta.',
  '/remote-cameras':
    'Streaming de Lente Anny. Podés elegir una cámara vinculada o vincular una nueva con su código de activación.',
  '/explore':
    'Sección Explorar. Podés elegir Dónde estoy para conocer tu ubicación, Explorador de mapa para buscar y recorrer lugares, o Lugares cercanos para encontrar comercios y servicios.',
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
    'Dispositivos. Acá podés activar Bluetooth, buscar Lentes Anny, conectarlos y abrir el lente.',
  '/glasses-network':
    'Lentes Anny. El Bluetooth ya está conectado. Elegí Hotspot o WiFi para conectar los lentes a internet.',
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

  useEffect(() => {
    const announcement = SCREEN_ANNOUNCEMENTS[pathname];

    if (!announcement) {
      return;
    }

    const timeout = setTimeout(() => {
      void speak(announcement);
    }, 250);

    return () => clearTimeout(timeout);
  }, [pathname]);

  return null;
}
