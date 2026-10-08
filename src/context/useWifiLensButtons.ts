import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
import type {LensPairing} from '../services/LocalWifiLens';
import {watchWifiLensButtons} from '../services/WifiLensButtons';

export function useWifiLensButtons(pair: LensPairing | null, onPress: () => void) {
  const callback = useRef(onPress);
  useEffect(() => { callback.current = onPress; }, [onPress]);
  const address = pair?.address;
  const password = pair?.password;
  const ap = pair?.ap;
  useEffect(() => {
    if (!address || !password || !ap) {return;}
    let stop: (() => void) | undefined;
    const update = (state: string) => {
      if (state === 'active') {
        if (!stop) {stop = watchWifiLensButtons({address, password, ap}, () => callback.current());}
      } else {
        stop?.();
        stop = undefined;
      }
    };
    update(AppState.currentState);
    const subscription = AppState.addEventListener('change', update);
    return () => {subscription.remove(); stop?.();};
  }, [address, password, ap]);
}
