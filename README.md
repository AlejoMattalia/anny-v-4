# Welcome to your Expo app 👋👋

## Prueba personal en iPhone desde Linux

El workflow `.github/workflows/ios-unsigned.yml` compila en macOS con Xcode
26.4.1 una IPA **sin firmar**, Release y arm64 (incluye iPhone 15 Pro).
Se ejecuta al subir una rama `ios-preview/**`; también admite ejecución manual
cuando el workflow está en la rama predeterminada. El artefacto
`anny-v4-iphone-unsigned` contiene la IPA y su SHA-256 y se conserva siete días.
No usa certificados, cuenta Apple ni publica en App Store/TestFlight.

El script equivalente en una Mac, después de `npm ci`, es
`bash scripts/build-ios-unsigned.sh`. Usa directorios nuevos bajo
`dist/ios-unsigned/`, sin borrar compilaciones anteriores. La app incluye el
bundle JavaScript y no necesita un servidor Metro abierto.

Esta primera prueba usa la cámara del iPhone para los tres escáneres. El
receptor UDP, el visor y el servicio de streaming en segundo plano de los
lentes son exclusivos de Android y todavía no están portados a iOS; la app
muestra esa limitación si se selecciona Lentes. La compilación no demuestra
que las funciones hayan sido probadas en un iPhone físico.

En CI se utilizan los endpoints públicos de `.env.example`. No se suben los
archivos `.env` locales ni la clave de Google Maps; la búsqueda de lugares
que requiere esa clave necesita configuración adicional. El indicador
`ANNY_IOS_UNSIGNED_PREVIEW=1` habilita HTTP en esta prueba porque los servicios
actuales usan HTTP y evita leer la clave del proyecto v3. Revisar HTTPS antes
de distribuir una versión de producción.

Una IPA sin firma **no se instala directamente en un iPhone**. Para probarla
en el dispositivo necesita firma personal mediante una herramienta de
instalación compatible. Generar este archivo no elimina ese requisito.

## Lentes WiFi: integración de anny-app-v3

Inicio y Dispositivos usan el mismo gestor `WifiLensConnectionManager` de v3:
selección WiFi/Hotspot, descubrimiento cercano BLE, redes guardadas (máximo ocho),
sincronización con el lente, reconexión y confirmación de la conexión real.
En Dispositivos se agregan, editan y eliminan redes. Guardar una red no
interrumpe la cámara; Conectar/Cambiar y el switch solicitan el cambio de red.
BLE configura el firmware `lente-wifi-2`; el video se transmite por WiFi.

La IA sigue la separación de v3: el escaneo usa `EXPO_PUBLIC_APP_API_IA_URL`
(Elastic Beanstalk, REST) y streaming usa `EXPO_PUBLIC_REALTIME_AI_URL`
(`http://ec2-3-15-63-191.us-east-2.compute.amazonaws.com`, Socket.IO).
Los escáneres de texto, imagen y billetes permiten cambiar entre **Lentes / Celular**
con un botón junto a **Detener voz**. El botón indica la cámara a la que se cambia.
Si la comprobación de conexión indica que los lentes están desconectados, el
escáner abre automáticamente la cámara del celular. Respeta la selección manual
y no repite el pedido de permiso si se rechaza.
Celular solicita permiso de cámara y utiliza la cámara trasera, tanto para el
escaneo automático como para el botón de captura. Al cambiar de cámara se
limpian el resultado y la voz anteriores; la cámara del celular se libera al
salir de la pantalla o enviar Anny a segundo plano.
Al abrir Streaming sin lentes conectados, se activa automáticamente la cámara
trasera del celular y se solicita permiso si hace falta. Con lentes conectados,
se usa su cámara. El botón **Lentes / Celular** permite cambiar manualmente,
incluso mientras se intenta conectar la cámara de los lentes.
Streaming envía `set_mode` y `analyze` con el modo elegido, consulta breve y
`requestId`; recibe `description`. Pide una frase completa de hasta 20 palabras.
El selector ofrece Viaje, Facultad, Supermercado, Deporte y Seguro, con las
mismas consultas de v3. También se cambia tocando Preguntar y diciendo, por
ejemplo, «modo supermercado». Cambiar de modo cancela el análisis anterior y
detiene su voz; al reconectar se restaura el modo seleccionado.

Dispositivos muestra redes en filas compactas: nombre, Conectar/Conectando/Conectado,
editar y eliminar. Agregar red está en la misma pantalla, con el selector
WiFi/Hotspot alineado a la izquierda. La ruta antigua de administración redirige aquí.

`patches/expo-speech+57.0.0.patch` conserva el motor TTS durante la vida del
módulo React, incluso si Android destruye y vuelve a crear MainActivity mientras
HeadlessJS sigue activo. Evita reutilizar un motor cerrado al volver a abrir Anny.
También respeta las etiquetas de idioma BCP 47 y comunica errores al iniciar voz.
`expo.autolinking.android.buildFromSource` incluye `expo-speech` para compilar
este parche en lugar de usar el binario precompilado del SDK.

Se portaron `LocalWifiLens`, `LensAutoProvisioning`, `WifiLensCamera`, el lector
de botones y los seis archivos Kotlin `LocalLens*` de `anny-app-v3`. El visor
nativo usa UDP con reparación FEC y alternativa MJPEG. La IA captura el cuadro
reciente del receptor nativo. Se retiró el visor temporal que consultaba
`/capture` continuamente. Las credenciales se guardan cifradas con Android
Keystore, como en v3. El servicio de primer plano conserva el receptor al
bloquear el teléfono mientras la pantalla de cámara permanece abierta.

El visor dibuja el video desde su decodificador en una `SurfaceView`, separado
del hilo de interfaz. Con firmware 2.4.13 y Hotspot, `playout_ms:40` activa un
buffer pequeño: 100 ms al inicio, hasta cuatro imágenes y descarte al superar
250 ms de edad. Esto suaviza entregas en ráfagas sin acumular segundos de video.
El ritmo de reproducción se adapta al ritmo recibido (40–100 ms entre imágenes).
Los eventos de estado usan el dispatcher de Fabric. Los logs `DISPLAY` incluyen
pausa máxima, tiempo de dibujo y edad máxima en el buffer.
Wi-Fi, MJPEG y firmware sin esa indicación mantienen sólo el último cuadro.
Las pruebas Kotlin cubren ráfagas, caducidad, límite de memoria y compatibilidad.

El visor prioriza movimiento: un parcial nuevo puede reemplazar un completo
anterior y todos los prefijos consecutivos se intentan decodificar, sin umbral
del 90 % ni espera de 300 ms. Puede verse una zona incompleta/gris. END permite
12 ms para reordenamiento; sin END, se libera el parcial tras 60 ms sin datos.
El watchdog de recepción usa el último JPEG realmente decodificado, evitando
que prefijos ilegibles oculten una imagen congelada. `DISPLAY partial_frames`
cuenta los parciales dibujados. Se mantienen FEC y recepción continua. Se solicita el perfil fluid
antes de abrir el video tanto en Wi-Fi como en Hotspot; el firmware elige el perfil de cada red.
La IA recibe únicamente cuadros completos recientes, incluidos los reparados por FEC.
El firmware Wi-Fi mejorado del 8 de octubre de 2026 fue reinstalado a pedido
del usuario: VGA, JPEG 12 inicial, presupuesto adaptativo de 16 KiB y envío
sin pausas artificiales en Wi-Fi. El binario y sus fuentes se conservan en
`lente-wifi-2/backups/wifi-quality-2026-10-08/`. Pruebas Kotlin de selección y
recuperación: `python3 tools/test-lens-frames.py` (requiere las dependencias
Kotlin del build Android en la caché de Gradle).

Las adaptaciones de v4 son Expo Router, voz con `expo-speech`, almacenamiento
de redes y contexto compartido. Los archivos Kotlin se registran mediante
`plugins/with-wifi-lens.js` para sobrevivir a `expo prebuild`.

En Android, el streaming de los lentes continúa al salir a Inicio o bloquear la
pantalla: conserva la recepción de imágenes, el análisis y las descripciones por
voz. Los ciclos de captura y los plazos de voz/análisis usan un reloj nativo
Android independiente de la pantalla; no acumulan capturas al volver a la app.
Iniciarlo con Anny abierta; la notificación «Lentes Anny activos» permite
volver al streaming. Pausar, salir de esa pantalla dentro de Anny o cerrar la
app desde Recientes libera el servicio. La cámara del celular y la escucha por
micrófono requieren primer plano. No funciona con el teléfono completamente
apagado ni después de forzar la detención de la app. Los perfiles de video de
Wi-Fi y Hotspot no se modifican para esta función.

El flujo de placa ESP32 con código de activación queda deshabilitado. Su
implementación se conserva en `src/disabled/esp32-camera-setup.tsx`; la ruta
anterior tiene comentada su exportación y redirige a Lentes WiFi.

```bash
npm run test:wifi
npx expo prebuild --platform android --no-install
npm run android
```

Los tests se portaron de v3. Se actualizaron dos fixtures antiguos: lectura BLE
de capacidades previa al aprovisionamiento y conservación de la conexión al
pasar a segundo plano hasta confirmar un fallo de estado.

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

Hotspot (9 de octubre de 2026, firmware 2.4.10): el perfil fluid arranca en
480×320 con JPEG 20 y un objetivo de 7 KiB por imagen. El intervalo inicial
entre capturas es de 67 ms (techo aproximado de 15 FPS, no tasa garantizada).
Anny negocia `feedback=1` y envía una ventana de recepción cada segundo:
cuadros completos, incompletos/perdidos y edad de la última imagen completa.
El firmware reduce el ritmo hasta intervalos de 150 ms si la pérdida alcanza
20 % en dos informes consecutivos o pasa un segundo sin imagen completa;
también puede aumentar la compresión. Recupera el ritmo gradualmente tras
cinco segundos con hasta 10 % de pérdida e imágenes completas recientes.
FEC y el protocolo anterior siguen disponibles; la app usa el heartbeat
anterior si el firmware no confirma feedback. Wi-Fi conserva VGA y su ritmo
sin limitación adicional. La mejora del hotspot del mismo teléfono necesita
una comprobación en ese escenario; los tests no garantizan fluidez en cada red.
