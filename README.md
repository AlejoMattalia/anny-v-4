# Welcome to your Expo app 👋👋

## Asistencia remota y cuenta tutor

Inicio, Ayuda y el botón de asistencia de Viaje → Ayuda y SOS abren la
asistencia de familiar o tutor. La sesión existente determina el rol `PDV`
o `TUTOR`; el tutor tiene un acceso a solicitudes y personas vinculadas.
En el menú, **Tutores y personas vinculadas** permite agregar una cuenta por
correo/código, editar su nombre y desvincularla. El PDV también puede invitar
a un tutor que todavía no tenga cuenta.

Se conserva el protocolo de `anny-app-v3`: `/group/list-mobile`,
`/group/add-user-chat`, `/notification/help`, `help-accepted`, `help-ignored`,
`response-camera`, `pending-camera` y `finalize-help`. El PDV envía su ubicación;
el tutor acepta, puede verla en el mapa e inicia la videollamada. OneSignal
identifica la instalación con el tag `user_id`, igual que v3. Activar **Avisos de
asistencia** en el teléfono del tutor; al cerrar sesión se retira esa asociación.
Mientras espera, el PDV consulta la respuesta de cámara cada dos segundos por
un máximo de 65 segundos. Cancelar impide abrir llamadas por respuestas tardías.

La llamada utiliza Voximplant y los mensajes `SHOW_GLASSES` / `SHOW_CAMERA`
de v3. Permite audio, video del celular y cambio a los lentes WiFi. El celular
del PDV envía cuadros completos de los lentes a `/frame/{port}` y el tutor ve
`/video_feed/{port}/{code}`. Sin lentes o tras fallos de envío se usa la cámara
del celular. Finalizar o salir libera la llamada y la reserva de video. El
envío de cuadros de lentes requiere Anny en primer plano; no se garantiza
continuidad de la llamada con el teléfono bloqueado.

La conexión inicial indica `ConnectionNode.NODE_1`, la misma ruta de la cuenta
existente en v3. El SDK 1.42+ exige ese parámetro: omitirlo rechaza la conexión
antes del login y terminaba mostrando el aviso genérico de revisar Internet.
Las pruebas de ambos roles exigen el nodo y comprueban el login posterior.

Las variables de `.env.example` incluyen los servidores de grupos/avisos,
el App ID de OneSignal y las cuentas Voximplant de cada rol (usuario completo,
incluido `@aplicacion.cuenta.voximplant.com`). En esta copia local se trasladó
la configuración de v3 al `.env` ignorado por Git. Las cuentas de llamadas de
v3 son compartidas por rol: conservan esa limitación para llamadas simultáneas;
no implementan credenciales individuales por usuario. Las variables
`EXPO_PUBLIC_*` se incluyen en el cliente y no son secretos de servidor.

Requiere reconstruir la app nativa; no funciona en Expo Go ni en la versión
web. `onesignal-expo-plugin` conserva la configuración al ejecutar prebuild
(modo APNs `development`; cambiar a `production` para distribución iOS).

```bash
npm run test:assistance
npx expo prebuild --platform android --no-install
npm run android
```

Prueba entre dos teléfonos: ingresar como PDV y TUTOR, vincular sus cuentas,
habilitar avisos en el tutor, pedir ayuda desde el PDV, aceptar y comenzar la
videollamada desde el tutor. Verificar audio, ubicación, cambio Celular/Lentes
y finalización desde cualquiera de los dos. Las pruebas automáticas simulan
los servicios; la entrega real de push y el audio/video requieren esa prueba.

## Lentes WiFi: integración de anny-app-v3

Inicio y Dispositivos usan el mismo gestor `WifiLensConnectionManager` de v3:
selección WiFi/Hotspot, descubrimiento cercano BLE, redes guardadas (máximo ocho),
sincronización con el lente, reconexión y confirmación de la conexión real.
En Dispositivos se agregan, editan y eliminan redes. Al guardar o corregir una
red, Anny intenta conectar automáticamente si los lentes están desconectados.
Si ya están conectados, sincroniza la lista y conserva la conexión y la cámara.
Al perder la conexión vuelve a buscar redes guardadas del modo seleccionado:
prioriza la red del celular y después las redes de 2,4 GHz con mejor señal.
Si Android no muestra ninguna red guardada (lista vacía, permiso denegado o
escaneo fallido), prueba las redes guardadas por Bluetooth: el lente busca
el WiFi y la app exige confirmar su SSID y acceso real antes de marcar conectado.
La recuperación se comprueba cada 15 segundos con Anny en primer plano;
los intentos de búsqueda y conexión pueden demorar más. Conectar y el switch
permiten solicitar un cambio manual. Una red nueva requiere guardar su nombre
y contraseña una vez, Bluetooth y los permisos de Android. El celular debe
poder comunicarse con los lentes en esa red; las redes sólo de 5 GHz y las que
exigen iniciar sesión en un portal no están cubiertas por este flujo.
BLE configura el firmware `lente-wifi-2`; el video se transmite por WiFi.
Cuando el lente está conectado, Inicio y Dispositivos muestran **Desconectar**.
El botón cierra la comunicación de Anny: cancela consultas y conexiones en
curso, retira la cámara nativa (cierre HTTP o STOP UDP), detiene el servicio de
streaming y las consultas del botón del lente. La elección se guarda para
evitar reconexiones al volver de ajustes, editar redes o reiniciar Anny.
**Conectar** o **Reintentar conexión** vuelven a habilitarla. Las redes y la
vinculación se conservan. Desconectar de Anny no apaga el hotspot del celular
ni ordena al firmware abandonar la red Wi-Fi; el lente permanece disponible
para una conexión explícita posterior.
Para usar el hotspot del mismo celular, elegir **Hotspot** en Dispositivos,
activar Compartir Internet en 2,4 GHz y guardar su nombre y contraseña.
El WiFi cliente del celular puede estar apagado: el lente se configura por BLE
y se comprueba por su IP local. Si el primer estado tarda o falla, Anny no
intenta activar ese WiFi ni desconectar la red. Tampoco usa SSID/resultados
guardados de un WiFi apagado para decidir que debe unirse al hotspot.
El formulario Hotspot permite ingresar los datos sin iniciar un escaneo.
Al agregar o editar un hotspot se elige **Este celular** u **Otro celular**.
Las redes nuevas proponen Este celular; las anteriores conservan su detección
automática hasta que se editen. Este celular impide escanear o unirse al propio
hotspot incluso en teléfonos que mantienen el WiFi cliente encendido.
El SSID confirmado y el origen se conservan en la vinculación: al recuperar
esa conexión, incluso después de cerrar Anny, la app sólo reintenta ese hotspot
mientras siga guardado con ese origen. Conectar otra red explícitamente,
editar el origen o borrar esa red permite cambiar la elección.
Para un hotspot de otro celular, conectar este celular a esa misma red;
la búsqueda y conexión asistida siguen disponibles con WiFi cliente activo.
Al volver desde ajustes se siguen reconociendo los cuadros de la cámara activa,
para que una consulta de estado fallida no marque desconectado un video vivo.
Si pasan 15 segundos sin imágenes con la cámara en primer plano, deja de
marcarse lista y se reabre el video local, sin reconfigurar WiFi ni BLE.
Si el lente ya no responde, se muestra el error y Reintentar; la recuperación
de red permanece a cargo del gestor. El monitor de imágenes se suspende al
pasar a segundo plano y se cancela al pausar o cerrar la cámara.
Estas rutas tienen pruebas simuladas; falta validar el corte reportado con
los lentes y el hotspot del mismo celular (WiFi cliente apagado).
El firmware 2.4.17 complementa esta recuperación: antes de buscar alternativas
reintenta el último hotspot hasta tres veces. Si se agotaron los intentos,
conserva su búsqueda de otras redes guardadas; la app mantiene su propia
selección Este celular y no adopta automáticamente un hotspot distinto.
También limita MJPEG a 10 FPS en Hotspot, evitando un envío sin pausa cuando
el transporte UDP no entrega video. UDP conserva su cadencia adaptativa y
la reducción de ritmo basada en los informes de recepción.
Si no aparecen los lentes por Bluetooth, Anny realiza hasta tres búsquedas
consecutivas de 20 segundos. El modal permanece abierto con «Buscando tus
lentes…», sin mostrar ni anunciar cada reintento. Al encontrarlos continúa
inmediatamente con la conexión. Cancelar detiene la búsqueda y los
intentos restantes. Bluetooth apagado, permisos denegados o errores del
escáner se informan directamente para poder corregirlos.

Si Android restaura una vinculación cifrada sin su clave de Keystore después
de reinstalar, Anny vuelve a vincular por Bluetooth usando la red guardada.
La vinculación anterior se reemplaza sólo al confirmar acceso a los lentes.
Dispositivos muestra el motivo cuando falla una conexión, además del estado
que se muestra en Inicio.
Si falla un intento iniciado al abrir Anny o con Conectar/Reintentar, el modal
conserva el motivo y ofrece Reintentar, Revisar redes y Cerrar. Los reintentos
automáticos no abren modales de error.
La búsqueda WiFi espera hasta ocho segundos; si Android no responde o limita
los escaneos, consulta los resultados disponibles para continuar la conexión.

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
