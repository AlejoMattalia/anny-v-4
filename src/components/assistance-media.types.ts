import type { Ref } from 'react';
import type { AssistanceRole } from '../lib/assistance-api';
import type { AssistanceRemoteCamera } from '../lib/assistance-remote-camera';
export type AssistanceMediaHandle = {
  sendSource: (glasses: boolean) => void;
  sendRemoteCamera: (camera: AssistanceRemoteCamera) => void;
};
export type AssistanceMediaProps = {
  ref?: Ref<AssistanceMediaHandle>;
  role: AssistanceRole;
  glasses?: boolean;
  serverVideo?: boolean;
  onConnected: () => void;
  onEnded: () => void;
  onSource: (glasses: boolean) => void;
  onRemoteCamera?: (camera: AssistanceRemoteCamera) => void;
  onLensVideoTransport?: (direct: boolean) => void;
  onError: (message: string) => void;
};
