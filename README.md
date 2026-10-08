# Welcome to your Expo app 👋

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

El visor prioriza el último cuadro completo sin acumular una cola. Un parcial
no reemplaza un cuadro completo pendiente de decodificar. Si la última imagen
completa tiene menos de 300 ms, conserva esa imagen; después admite parciales
con al menos 90 % de bytes JPEG consecutivos. Esa proporción no mide píxeles
visibles. Se mantienen FEC y recepción continua. En Wi-Fi se solicita el perfil fluid
antes de abrir el video; el firmware actual conserva VGA con compresión equilibrada para el video.
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

Hotspot (8 de octubre de 2026): el perfil fluid parte de 640×480 con JPEG 16
y un presupuesto de 12 KiB. Ante congestión baja a 480×320 con presupuesto
de 9 KiB, evitando las caídas a 400×296 y 320×240. Wi-Fi conserva su perfil VGA.
