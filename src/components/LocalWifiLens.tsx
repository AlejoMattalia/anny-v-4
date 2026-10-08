import React from 'react';
import {
  requireNativeComponent,
  StyleSheet,
  ViewProps,
} from 'react-native';
import {useIsFocused} from 'expo-router';
import {LensPairing} from '../services/LocalWifiLens';

const LiveStream = requireNativeComponent<
  ViewProps & {endpoint: string; credential: string; onStreamReady?: () => void; onStreamFrame?: () => void}
>('LocalLensStream');
/** Native authenticated MJPEG surface used by the Wi-Fi camera adapter. */
export default function LocalWifiLens({
  session,
  fullscreen = false,
  onStreamReady,
  onStreamFrame,
}: {
  session: LensPairing;
  fullscreen?: boolean;
  onStreamReady?: () => void;
  onStreamFrame?: () => void;
}) {
  const focused = useIsFocused();
  // Locking the phone pauses the Activity but must not detach the native UDP receiver.
  return focused ? (
    <LiveStream
      style={fullscreen ? styles.fullscreen : styles.stream}
      endpoint={`${session.address}/stream`}
      credential={session.password}
      onStreamReady={onStreamReady}
      onStreamFrame={onStreamFrame}
    />
  ) : null;
}
const styles = StyleSheet.create({
  fullscreen: {flex: 1, backgroundColor: '#000'},
  stream: {
    width: '100%',
    aspectRatio: 4 / 3,
    marginVertical: 12,
    backgroundColor: '#000',
  },
});
