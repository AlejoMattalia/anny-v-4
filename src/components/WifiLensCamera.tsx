import React, {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useIsFocused} from 'expo-router';
import LocalWifiLens from './LocalWifiLens';
import {
  findLocalLens,
  LensPairing,
  loadLensPairing,
  releaseLensNetwork,
  saveLensPairing,
} from '../services/LocalWifiLens';
import {captureWifiLens} from '../services/WifiLensCamera';
import {hasLocalLensTransport, requestLocalLens} from '../services/LocalLensTransport';
import {WifiLensContext} from '../context/wifi-lens-context';
import {startGlassesStreamingService, stopGlassesStreamingService} from '../services/GlassesStreamingService';

export type WifiLensCameraHandle = {capture: () => Promise<string>};

/** Camera adapter for the lente-wifi-2 firmware, shared with v3. */
const WifiLensCamera = forwardRef<
  WifiLensCameraHandle,
  {onReady: (ready: boolean) => void}
>(({onReady}, ref) => {
  const focused = useIsFocused();
  const {trackWifiLensCamera, wifiLensConnection} = useContext(WifiLensContext);
  const reconnecting = wifiLensConnection.phase === 'searching' || wifiLensConnection.phase === 'connecting';
  const verifiedSSID = useRef('');
  const reportFrame = useRef<(() => void) | null>(null);
  const streamOwner = useRef(Symbol('wifi-lens-camera'));
  const [session, setSession] = useState<LensPairing | null>(null);
  const sessionRef = useRef<LensPairing | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const operations = useRef(new Set<AbortController>());
  const readyCallback = useRef(onReady);
  useEffect(() => { readyCallback.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!focused || !session) return;
    const owner = streamOwner.current;
    void startGlassesStreamingService(owner).catch(error =>
      console.warn('[WifiLensCamera] Could not keep stream active in background:', error),
    );
    return () => { void stopGlassesStreamingService(owner); };
  }, [focused, session]);

  useEffect(() => {
    const controller = new AbortController();
    sessionRef.current = null;
    reportFrame.current = null;
    setSession(null);
    readyCallback.current(false);
    if (!focused || reconnecting) {
      return;
    }
    setError('');
    const open = async () => {
      try {
        // Release the binding used during provisioning so cloud AI can use
        // the normal Internet route (including cellular with a hotspot).
        await releaseLensNetwork();
        const pair = await loadLensPairing();
        if (!pair) {
          throw new Error(
            'Conectá tus lentes Wi-Fi desde Dispositivos antes de abrir la cámara.',
          );
        }
        const found = await findLocalLens(pair, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (!found.state.camera) {
          throw new Error('La cámara de los lentes no está disponible.');
        }
        const connected = {...pair, address: found.address};
        if (connected.networkType !== 'hotspot' && hasLocalLensTransport()) {
          // Prefer the fluid VGA profile; do not overload Wi-Fi with detail JPEGs.
          // Older firmware may lack this endpoint; video remains available.
          await requestLocalLens(`${connected.address}/api/camera`, connected.password,
            'profile=fluid', 5000, controller.signal).catch(() => undefined);
          if (controller.signal.aborted) return;
        }
        // Open the video directly. A preliminary /capture blocks the lens's
        // control server while it sends an entire JPEG over a slow radio.
        await saveLensPairing(connected);
        const activity = await trackWifiLensCamera(connected, found.state);
        if (controller.signal.aborted) {
          return;
        }
        verifiedSSID.current = found.state.ssid;
        sessionRef.current = connected;
        reportFrame.current = activity;
        setSession(connected);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'No se encontraron los lentes.',
          );
        }
      }
    };
    open();
    const captures = operations.current;
    return () => {
      controller.abort();
      sessionRef.current = null;
      reportFrame.current = null;
      captures.forEach(operation => operation.abort());
      captures.clear();
      readyCallback.current(false);
    };
  }, [focused, attempt, trackWifiLensCamera, reconnecting]);

  // Roaming may complete in firmware before the next status poll. Replace the
  // native stream only when the verified address/SSID actually changed.
  useEffect(() => {
    const current = sessionRef.current;
    if (!focused || wifiLensConnection.phase !== 'connected') {return;}
    if ((current && (current.address !== wifiLensConnection.session?.address ||
         verifiedSSID.current !== wifiLensConnection.ssid)) || (!current && error)) {
      setAttempt(value => value + 1);
    }
    // Retry only when the connection changes; including error would loop on an unavailable lens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, wifiLensConnection.phase, wifiLensConnection.session?.address, wifiLensConnection.ssid]);

  useImperativeHandle(
    ref,
    () => ({
      async capture() {
        const current = sessionRef.current;
        if (!current) {
          throw new Error('Esperá a que se conecte la cámara de los lentes.');
        }
        if (operations.current.size) {
          throw new Error('Ya hay una captura en curso.');
        }
        const controller = new AbortController();
        operations.current.add(controller);
        try {
          return await captureWifiLens(current, controller.signal);
        } finally {
          operations.current.delete(controller);
        }
      },
    }),
    [],
  );

  return (
    <View style={styles.container}>
      {session && focused ? (
        <LocalWifiLens
          session={session}
          fullscreen
          onStreamFrame={() => {
            if (focused && sessionRef.current === session) {
              reportFrame.current?.();
            }
          }}
          onStreamReady={() => {
            if (focused && sessionRef.current === session) {
              readyCallback.current(true);
            }
          }}
        />
      ) : (
        <View style={styles.message}>
          {error ? (
            <>
              <Text style={styles.text} accessibilityLiveRegion="polite">
                {error}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Reintentar cámara de lentes Wi-Fi"
                onPress={() => setAttempt(value => value + 1)}
                style={styles.retry}>
                <Text style={styles.text}>REINTENTAR</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color="#00FFCC" />
              <Text style={styles.text}>Conectando cámara de los lentes…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
});

WifiLensCamera.displayName = 'WifiLensCamera';

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000'},
  message: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  text: {color: '#fff', textAlign: 'center', marginVertical: 12, fontSize: 17},
  retry: {backgroundColor: '#542264', paddingHorizontal: 24, borderRadius: 12},
});
export default WifiLensCamera;
