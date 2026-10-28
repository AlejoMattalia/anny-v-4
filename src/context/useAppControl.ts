import { useEffect, useRef } from 'react';
import { useIsFocused, usePathname } from 'expo-router';
import { appControl, type AppSnapshot, type AppHandlers } from '../services/AppControl';

export function useAppControl(snapshot: AppSnapshot, handlers: AppHandlers) {
  const focused = useIsFocused();
  const path = usePathname();
  const current = useRef({ snapshot, handlers });
  current.current = { snapshot, handlers };
  useEffect(() => {
    if (!focused) return;
    return appControl.register(path, () => current.current.snapshot, () => current.current.handlers);
  }, [focused, path]);
}
