import type { Ref } from 'react';
import type { AssistanceRole } from '../lib/assistance-api';
export type AssistanceMediaHandle = { sendSource: (glasses: boolean) => void };
export type AssistanceMediaProps = {
  ref?: Ref<AssistanceMediaHandle>;
  role: AssistanceRole;
  onConnected: () => void;
  onEnded: () => void;
  onSource: (glasses: boolean) => void;
  onError: (message: string) => void;
};
