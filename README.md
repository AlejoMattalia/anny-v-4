# Welcome to your Expo app 👋👋

## iPhone: adaptación nativa

`anny-v4` incluye una implementación iOS de los módulos de lentes en
`plugins/lens-wifi/ios`. El plugin `with-wifi-lens` agrega el pod `AnnyLens`
durante `expo prebuild`; no editar el directorio generado `ios/`.
Requiere una compilación propia, no Expo Go.

En iOS, `expo-build-properties.ios.usePrecompiledModules` está desactivado
para compilar los módulos de Expo contra el mismo `ExpoModulesCore` instalado.
La IPA 1.0.9 (10) mezclaba binarios precompilados incompatibles: `dyld` la
cerraba al arrancar porque `ExpoCamera` requería el símbolo Swift
`AnyModule._decorateModule(object:in:)`, ausente en el núcleo incluido.
Mantener esta opción en las compilaciones locales y de EAS; después de cambiarla
hay que generar e instalar una nueva IPA. Una actualización de JavaScript
no reemplaza esos binarios.

- Vinculación guardada en Keychain y configuración de los lentes mediante BLE.
  Se espera la inicialización de CoreBluetooth y el permiso inicial de iOS.
- Transporte HTTP local cancelable y video UDP con recuperación FEC y respaldo
  MJPEG. El receptor conserva el cuadro más reciente para evitar acumular retraso.
  Las capturas para IA usan únicamente JPEG completos y recientes del stream.
- Video al tutor mediante `VICustomVideoSource` de Voximplant: cuadros mostrados
  por los lentes o cámara trasera del iPhone, manteniendo la misma llamada.
  En iOS la fuente se instala antes de responder, como exige el SDK.
- QR y códigos de productos desde los lentes mediante Vision. La función de
  Expo para imágenes estáticas en iOS sólo detecta QR; la cámara del celular
  conserva el lector de Expo.
- Voz audible en modo silencio y recuperación de la conversación si iOS
  termina el proceso de WebKit. La IA y los anuncios siguen silenciados durante
  la asistencia con un tutor.

En iPhone se puede consultar la red Wi-Fi actual y escribir otra manualmente;
iOS no ofrece el escaneo de redes cercanas de Android. Al compartir Internet,
activar **Maximizar compatibilidad** y seleccionar **Este celular**. Para otro
teléfono, seleccionar **Otro celular**; Anny puede solicitar unirse a su hotspot.
Los lentes actuales usan BLE + Wi-Fi. El transporte antiguo Bluetooth Classic
SPP de Android no tiene equivalente genérico en iPhone.

El video y el análisis visual se pausan al pasar a segundo plano en iOS y se
reanudan al volver a la app. No se promete video con el iPhone bloqueado. El
modo de audio en segundo plano está declarado para las llamadas.

`eas.json` contiene `preview` para instalación interna en un iPhone registrado,
`ios-simulator` y `production`. Se conserva el identificador
`com.anonymous.annyv4`. Los perfiles `preview` y `production` configuran APNs
de producción; la ejecución local usa desarrollo. Para probar después:

1. Iniciar sesión en Expo, vincular el proyecto con EAS y registrar el iPhone.
2. Configurar en el entorno `preview` de EAS las mismas variables
   `EXPO_PUBLIC_*` que usa la instalación Android. `.env` no está versionado:
   revisar especialmente URLs de servicios, Google Places, usuarios de llamadas
   y OneSignal. El servicio de conversación debe usar HTTPS.
3. Configurar las credenciales APNs de esta app en OneSignal para recibir avisos
   en iOS. Las credenciales de Android no habilitan APNs.
4. Ejecutar `npx eas-cli@latest build --platform ios --profile preview` y usar la
   firma Ad Hoc de la cuenta Apple. TestFlight no es necesario para ese perfil.

Validación local: `npm run test:wifi`, `npm run test:voice`,
`npm run test:assistance`, `npm run test:ios-lens`, `npx tsc --noEmit` y
`npx expo export --platform ios`. `test:ios-lens` compila el protocolo portable
con AddressSanitizer y UndefinedBehaviorSanitizer: orden y pérdida de paquetes,
FEC, plazos de cuadros parciales, feedback, entradas inválidas, MJPEG y NV12.
La generación de iOS se valida con `npx expo prebuild --platform ios --no-install`.
Estas comprobaciones **no compilan los módulos Objective-C++ contra Xcode**.
La compilación iOS 1.0.9 (11) se compiló y firmó en EAS. Se verificó la IPA:
los módulos afectados se enlazan desde código fuente y las 194 referencias
dinámicas a frameworks Expo incluidos se resuelven, sin los símbolos ausentes
de la compilación 10. El usuario confirmó que la compilación 11 abre en su
iPhone. Las pruebas funcionales, incluida la conexión de los lentes, siguen
pendientes en el dispositivo.

En el iPhone se debe verificar el primer pedido de permisos, lentes por router
y hotspot, cambio lentes/celular durante llamadas iPhone–Android en ambos roles,
orientación y fluidez del video, audio Bluetooth, voz con modo silencio,
ubicación/lugares cercanos, códigos de productos, reconexión y notificaciones.
Usar iOS 16.4 o posterior, conforme al mínimo del SDK Expo 57.

## Comandos de voz de v3

En Inicio, el micrófono sin texto de la barra inferior inicia o cancela la
escucha. **Hablar con Anny** abre la conversación con la IA y conserva un
acceso separado de los comandos. En las otras pantallas se ofrece un micrófono
flotante; el botón físico de los lentes también inicia o cancela la escucha.
Durante una llamada el micrófono queda reservado para el audio. Streaming usa
su botón **Preguntar** y admite «Anny» seguido de cualquier comando, además de
«ayuda» y los cinco modos. No mantiene una escucha permanente en segundo plano.

`src/services/VoiceCommands.ts` reúne los 58 nombres y variantes presentes en
los catálogos de `AccessibilityContext`, `glassesContext` y el mapa de v3.
Incluye navegación de pantallas, texto/imagen/billete, streaming y sus modos,
ayuda a tutores, ubicación, lugares cercanos, radio/audiolibros, WiFi/Hotspot,
repetición, cancelación, pausa/reanudación del asistente y etapas del colectivo.
Se aceptan acentos omitidos, variantes Wi-Fi y el prefijo Anny. Se comprueban
todos los roles de la cuenta y no se ejecutan órdenes por menciones dentro de
preguntas o negaciones. Perfil → Comandos muestra las opciones de cada rol.

«Ir a Hospital Córdoba en colectivo» prepara el destino y transporte en la
planificación, como v3, sin iniciar un viaje sin revisar la ruta. Busca primero
ubicaciones guardadas y luego direcciones. Durante el viaje, siguiente/anterior,
ascenso/descenso y repetir llaman a las mismas acciones de los botones. Pausar
asistente silencia indicaciones sin detener GPS ni el avance del recorrido.
En escáneres, repetir toma una imagen nueva. Iniciar/parar detección controla el
análisis de objetos de los lentes en Streaming con la IA ya integrada en v4.

«Código» abre el lector QR/barras con celular o lentes. Conserva las acciones
de v3: consulta `/api/product/{codigo}`, abre enlaces HTTP(S), y guarda/conecta
redes de códigos WiFi. Los lentes se leen desde el JPEG local, sin abrir otra
cámara o reserva de streaming remoto. `expo-image-loader` permite decodificar
esa imagen; se habilita el lector de códigos del plugin `expo-camera`.

La escucha se cancela al salir, cambiar de cuenta o pasar a segundo plano,
incluso si Android aún estaba pidiendo permiso. La voz de Anny se silencia
mientras reconoce al usuario para evitar que ejecute sus propios anuncios.
Si el micrófono ya tiene permiso, no se vuelve a abrir la solicitud de Android:
esa solicitud podía pausar la actividad y cancelar la escucha justo después del
aviso. Cancelar sólo aborta un reconocedor activo; un reintento espera el cierre
nativo anterior y descarta sus eventos atrasados antes del nuevo inicio. Una
interrupción inesperada se informa en voz alta, en lugar de cerrarse en silencio.
`npm run test:voice` verifica el inventario original, ejecución, permisos por
rol, aislamiento de acciones por pantalla, cancelación y códigos WiFi.
La precisión del reconocimiento y la lectura de códigos requieren además
probar el APK en un teléfono con micrófono y cámara reales.

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
de v3. El audio prioriza el lente o auricular Bluetooth que el sistema tenga
disponible para llamadas; después auriculares con cable y, por último, el celular.
La salida se actualiza al conectar o desconectar el dispositivo, independientemente
de la cámara elegida. En Android 12+ se solicita `BLUETOOTH_CONNECT` cuando falta.
La conexión Wi-Fi de la cámara por sí sola no habilita audio Bluetooth.

Al entrar, el PDV busca primero un lente habilitado y online en
**Cámaras remotas** (`EXPO_PUBLIC_STREAMING_API_URL`). Obtiene una sesión
de reproducción del servidor y comparte su URL temporal con el tutor mediante
`ANNY_REMOTE_CAMERA_V1`, dentro de la llamada. Ambos reproducen directamente
el mismo WebRTC del servidor con `RemoteCameraStream`, mostrando el cuadro
completo y su proporción original, igual que la pantalla de Cámaras remotas.
Este camino no captura JPEG, no sube cuadros a `/frame` y no recodifica el video
en el celular. Voximplant mantiene el audio y los controles de cambio de cámara.
El PDV renueva el acceso antes de vencer y comparte la nueva URL sin reiniciar
una reproducción activa; al volver del segundo plano se evita abrir un enlace
vencido. Ambos teléfonos necesitan esta versión para interpretar el nuevo
mensaje. Falta verificar los FPS y la latencia real con dos teléfonos.

Si no hay un lente del servidor disponible, permite video del celular y cambio
a los lentes WiFi conectados localmente.
Entre dos Android actualizados, `LENS_VIDEO_WEBRTC_V1` negocia enviar los lentes
por la pista de video de la llamada. El decodificador entrega el mismo bitmap
que acaba de mostrar localmente, incluidos los parciales legibles. Un trabajador
nativo lo convierte a I420 y lo entrega a Voximplant, sin capturas base64,
peticiones HTTP por imagen ni descarte adicional de parciales. Conserva sólo
el último cuadro pendiente para que un codificador lento no frene la vista local.
El tutor muestra esa pista en el visor nativo, sin un WebView superpuesto.
La cámara trasera del celular usa el capturador del SDK y la misma pista;
cambiar Celular/Lentes cambia el origen sin cortar el audio. La fuente se
configura antes de habilitar el primer video: el setter del SDK no reemplaza
una pista ya creada. El puente está ligado al SDK Android 2.45.0 instalado.

Si alguno de los teléfonos no tiene el puente Android, se conserva el transporte
anterior: el PDV envía cuadros completos a `/frame/{port}` y el tutor muestra
`/video_feed/{port}/{code}`. `LENS_VIDEO_HTTP` permite volver a ese transporte
si falla la configuración nativa. Finalizar o salir libera el trabajador,
el capturador, la llamada y la reserva de video. El envío de lentes requiere
Anny en primer plano; no se garantiza continuidad con el teléfono bloqueado.

El envío HTTP de compatibilidad cuenta captura y respuesta dentro del intervalo
objetivo de 15 FPS, en lugar de agregar 150 ms después de cada respuesta.
Conserva un solo envío en curso y captura el cuadro actual al terminar, sin
acumular imágenes en redes lentas. La tasa real depende de la red y el servidor:
con 200 ms por envío, la prueba simulada pasa de unos 3 a unos 5 envíos/s.
El tutor recibe video sin transmitir su cámara, que no se muestra. El PDV
libera la cámara física del celular mientras comparte los lentes y la restaura
al elegir Celular. Las pruebas cubren negociación, compatibilidad, selección de
fuente, I420, cola acotada y cancelación; falta medir la fluidez entre dos teléfonos.

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
La recuperación del video vuelve a estar a cargo del receptor nativo, como
antes del cambio de Desconectar: intenta UDP, pasa a MJPEG si falla y reabre
el socket cuando se corta. Se retiró el reinicio adicional de JavaScript a
los 15 segundos sin imágenes: podía interrumpir esa transición y volver a
negociar UDP repetidamente en un hotspot lento. Pausar, Desconectar o cambiar
de lente/red sí cierra el receptor. Un error al abrir la cámara permite
Reintentar; la recuperación de red permanece a cargo del gestor.
La prueba de regresión reproduce una espera de 32 segundos en el receptor
y comprueba que no se lo reemplaza antes de recibir su primera imagen.
En la comparación del 26/10 con un SM-G990E conectado al hotspot de un iPhone
y firmware 2.4.16, tanto el APK del 16/10 como el actual mostraron alrededor de
15 FPS y pausas ocasionales cercanas a un segundo. El lente registró rechazos
de paquetes por memoria/cola de radio; quitar el reinicio no elimina ese límite.
El búfer Android descarta imágenes que llevan más de 150 ms esperando (antes
250 ms), conservando los 100 ms iniciales y la reproducción a ritmo uniforme.
Ese límite reduce la demora de la cola; no representa la latencia total del video.
La prueba con hotspot alojado en el mismo Samsung sigue pendiente.
El firmware 2.4.17 complementa esta recuperación: antes de buscar alternativas
reintenta el último hotspot hasta tres veces. Si se agotaron los intentos,
conserva su búsqueda de otras redes guardadas; la app mantiene su propia
selección Este celular y no adopta automáticamente un hotspot distinto.
También limita MJPEG a 10 FPS en Hotspot, evitando un envío sin pausa cuando
el transporte UDP no entrega video. UDP conserva su cadencia adaptativa y
la reducción de ritmo basada en los informes de recepción.
Si no aparecen los lentes por Bluetooth, Anny realiza hasta tres búsquedas
consecutivas de 20 segundos en modo de escaneo continuo. Al abrir Anny se
conserva el modal de conexión, igual que con Conectar/Reintentar. La tarjeta
también permite **Cancelar conexión** durante una búsqueda.
Cancelar cierra ese intento y suspende la reconexión hasta tocar Conectar.
Bluetooth apagado, permisos denegados o errores del escáner se informan
directamente. Las promesas nativas de inicio y fin de escaneo también se
comprueban; los pasos GATT tienen límites y cancelación.
En Android el filtro de identidad/servicio se aplica en la app para evitar
depender de ranuras de filtros del controlador: el SM-G990E conectado el
26/10/2026 registró filtros de Anny bloqueados por falta de ranuras. Un lente
ya vinculado se selecciona sólo por su identificador guardado; una primera
vinculación requiere anunciar el servicio de provisión.
Si no se encuentra el lente, la búsqueda termina sin repetirse por cada red
guardada ni reiniciarse automáticamente cada 15 segundos. Un intento completo
tiene un límite de 180 segundos cuando muestra el modal (inicio o conexión
manual), y de 90 segundos en recuperaciones automáticas posteriores, seguido
de hasta 3,5 segundos para liberar una operación nativa que no responde.
Las consultas pasivas pueden reconocer un lente que vuelva a estar accesible.

Si Android restaura una vinculación cifrada sin su clave de Keystore después
de reinstalar, Anny vuelve a vincular por Bluetooth usando la red guardada.
La vinculación anterior se reemplaza sólo al confirmar acceso a los lentes.
Dispositivos muestra el motivo cuando falla una conexión, además del estado
que se muestra en Inicio.
Si falla un intento iniciado al abrir Anny o con Conectar/Reintentar, el modal
conserva el motivo y ofrece Reintentar, Revisar redes y Cerrar. Los reintentos
automáticos posteriores no abren modales de error.
La búsqueda WiFi espera hasta ocho segundos; si Android no responde o limita
los escaneos, consulta los resultados disponibles para continuar la conexión.

**Hablar con Anny** en Inicio abre una conversación de voz en tiempo real, con
interrupciones, preguntas sobre Anny y herramientas para usar sus funciones.
Su backend es el proyecto independiente `../anny-voice-api`; se configura con
`EXPO_PUBLIC_VOICE_API_URL` y utiliza el login de la app. La clave de OpenAI queda
en el servidor. La conversación permanece disponible al abrir otras funciones, minimizada en una
barra. Puede preparar e iniciar un viaje, leer capturas actuales y controlar el
streaming, además de ajustes y datos de la app. Al enviar la app a segundo plano,
iniciar una videollamada o finalizar, libera el micrófono. Más detalles en `../anny-voice-api/README.md`.

El inicio de la conversación usa sólo permiso de micrófono en Android, sin
iniciar el reconocedor de voz del sistema. Cada etapa tiene un plazo: la
liberación de voz anterior continúa después de dos segundos aunque el módulo
nativo no confirme; sesión, almacenamiento y carga del audio muestran errores
concretos si no responden. La interfaz muestra el progreso y repite la señal de
página lista al finalizar la carga del WebView para recuperar un aviso perdido.

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


Las imágenes de visión se preparan en `src/lib/vision-upload.ts` antes de subirlas.
El escáner conserva hasta 2048 píxeles en el lado mayor y un máximo de 900 KiB,
con margen para los campos multipart bajo el límite de 1 MiB del proxy de
Elastic Beanstalk. Streaming utiliza hasta 1280 píxeles y 320 KiB para reducir
tráfico y latencia. Las capturas pequeñas de los lentes pasan sin recomprimir.
Si una foto sigue excediendo el presupuesto, se reduce de nuevo antes de enviarla;
las copias temporales generadas se eliminan al terminar.

La conversación de voz conserva su estado al abrir un viaje, streaming, permisos
o minimizar la página de voz. Las lecturas nuevas de streaming y guía de viajes
se envían con prioridad; los anuncios de herramientas no las silencian. La
conexión técnica se renueva automáticamente con el contexto reciente sin iniciar
una charla nueva ni perder el borrador del viaje. El cierre por voz exige una
petición explícita; indicar un destino o terminar un viaje no cierra la charla.

Versión 1.0.4 (Android 5): la decisión y ejecución de herramientas se hacen sin
audio; sólo se lee la respuesta final. Las lecturas nuevas esperan el final de la
frase actual. La voz local del teléfono no reemplaza a la conversación durante
una reconexión. «La terminal», «una farmacia» y otras categorías consultan el mapa
en un radio de 25 km del GPS, descartan resultados lejanos y eligen el más cercano
entre los resultados. El origen se obtiene del GPS y, si no indicaron transporte,
se prepara a pie. Se conservan los permisos ya concedidos y el GPS tiene un plazo
de 20 segundos para no bloquear el viaje.

Versión 1.0.6: en la conversación se muestra sólo el círculo; no se renderizan
transcripciones, títulos ni mensajes visibles. El círculo minimizado abre la
conversación; mantenerlo presionado finaliza. La pantalla conserva las etiquetas
accesibles y el círculo de error permite reintentar sin mostrar textos.

Versión 1.0.7: streaming consulta disponibilidad cada 100 ms (antes 1500 ms) y
empieza a capturar a los 100 ms. `StreamingNarration` prepara una escena cerca del
final de la locución actual, conserva como máximo una pendiente y descarta
resultados antiguos o de otro modo. El aviso de comienzo real de voz sincroniza
la precaptura tanto con el TTS nativo como con la conversación. Las fotos del
celular usan un tamaño admitido por la cámara; navegación limita la subida a
128 KiB/960 px y lectura mantiene 320 KiB/1280 px. No hay un anuncio de conexión
que retrase la primera descripción.

## Conversación: búsquedas locales (1.0.8)

La conversación resuelve destinos por categoría (shopping, kiosco/quiosco, farmacia,
supermercado y otros) mediante Google Places y alternativas OpenStreetMap
(Overpass e índice Nominatim). Las búsquedas sin otra localidad quedan acotadas
a 25 km del GPS, ordenadas por distancia. Una ciudad explícita, como «farmacia
en Rosario», cambia el centro de búsqueda, conservando el GPS como origen del
viaje. Los nombres ambiguos devuelven opciones con dirección. No se convierte
una búsqueda local sin resultados en un viaje a otra ciudad. Si los proveedores
fallan o no tienen datos, se informa esa situación y se ofrecen nuevos intentos
o barrios, sin inventar comercios ni exigir el nombre comercial exacto.

El aviso de voz «Estoy pensando» se administra en `anny-voice-api/public/voice.js`:
se reserva a herramientas de búsqueda/análisis que superan 3,5 segundos; no se
programa por el solo hecho de hablar, saludar o generar una respuesta normal.

## Conversación: precisión y llamada (1.0.9)

Antes de preparar una ruta, la conversación exige coordenadas válidas,
un dato de hasta 30 segundos y precisión informada de 50 metros o mejor. Pide
al teléfono alta precisión; si la primera muestra no cumple, intenta una nueva
y, si sigue siendo aproximada, pregunta la calle/altura sin consultar destinos
con ese origen. Estos controles no garantizan que el GPS o los mapas no tengan
errores. Destinos genéricos con varias opciones requieren elegir; incluso
«el más cercano» requiere elegir si la diferencia está dentro del margen del
GPS. Una localidad con varias coincidencias también requiere aclaración.

La pantalla conserva el círculo y agrega un botón de colgar sin texto, accesible
como «Finalizar llamada con Anny», que también cancela una conexión pendiente.
Se reconocen «colgá», «cortá la llamada» y «finalizar llamada». El aviso
«Conectando con Anny IA» es una grabación Coral incluida en la APK, reproducida
una vez por llamada, antes del micrófono de Realtime y sin depender del servidor.


Explorar y la conversación comparten la consulta general de lugares cercanos
(1,5 km, nombres, direcciones y distancias; se excluyen ciudades y resultados
fuera del radio). Si la lista está abierta, la IA usa esos mismos resultados.
Las búsquedas por categoría o en otra ciudad conservan su búsqueda específica.
Dónde estoy comparte la ubicación reciente de alta precisión con la pantalla;
puede informar un dato aproximado con su precisión, sin exigir la precisión
necesaria para decidir el origen de una ruta. Si Android sólo devuelve la ciudad,
se intenta resolver la calle con Google Geocoding y OpenStreetMap; sin dirección
se informa esa limitación y se conservan las coordenadas. Las consultas tienen
un límite de espera y los errores del caché de Android no impiden consultar GPS.

Cuando comienza una videollamada con un tutor, se finaliza la sesión de IA,
se libera su micrófono y se cancela el reconocimiento de comandos. Las lecturas
automáticas se silencian durante la llamada; no se reabre la IA al colgar.
