import {NativeModules, Platform} from 'react-native';

// Samsung may suspend Choreographer/vsync in background even with HeadlessJS
// active. Native Handler deadlines keep this work independent of the display.
export function streamingDelay(milliseconds: number): Promise<void> {
  if (Platform.OS === 'android' && NativeModules.LocalLensFrames?.delay) {
    return NativeModules.LocalLensFrames.delay(milliseconds);
  }
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function streamingTimeout(callback: () => void, milliseconds: number): () => void {
  if (Platform.OS !== 'android' || !NativeModules.LocalLensFrames?.delay) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  }
  let cancelled = false;
  void streamingDelay(milliseconds).then(() => { if (!cancelled) callback(); });
  return () => { cancelled = true; };
}

export function streamingInterval(callback: () => void, interval: number, initial: number): () => void {
  let cancelled = false;
  void (async () => {
    await streamingDelay(initial);
    while (!cancelled) {
      callback();
      await streamingDelay(interval);
    }
  })();
  return () => { cancelled = true; };
}
