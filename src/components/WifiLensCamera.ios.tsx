import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type WifiLensCameraHandle = { capture: () => Promise<string> };

// The Android SurfaceView/UDP receiver has not been ported to iOS yet.
// Do not mount LocalLensStream on an iPhone: that native view does not exist.
const WifiLensCamera = forwardRef<WifiLensCameraHandle, {
  onReady: (ready: boolean) => void;
  active?: boolean;
  onBackgroundReady?: (ready: boolean) => void;
}>(({ onReady, onBackgroundReady }, ref) => {
  useEffect(() => {
    onReady(false);
    onBackgroundReady?.(false);
  }, [onReady, onBackgroundReady]);
  useImperativeHandle(ref, () => ({
    async capture() {
      throw new Error('Usá la cámara del celular para escanear en esta versión para iPhone.');
    },
  }), []);

  return (
    <View style={styles.container}>
      <Text style={styles.message}>
        Los lentes todavía no están disponibles en esta versión para iPhone.
        Para escanear, usá la cámara del celular.
      </Text>
    </View>
  );
});
WifiLensCamera.displayName = 'WifiLensCamera';
export default WifiLensCamera;

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#111827', borderRadius: 16 },
  message: { color: '#FFFFFF', fontSize: 18, textAlign: 'center' },
});
