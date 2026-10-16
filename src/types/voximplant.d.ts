// The v3-compatible SDK ships Flow, but no TypeScript declarations.
declare module 'react-native-voximplant' {
  import type { ComponentType } from 'react';
  import type { ViewProps } from 'react-native';
  export interface Endpoint {
    on(event: string, listener: (event: VoxEvent) => void): void;
    off(event: string, listener?: (event: VoxEvent) => void): void;
  }
  export interface Call {
    on(event: string, listener: (event: VoxEvent) => void): void;
    off(event: string, listener?: (event: VoxEvent) => void): void;
    getEndpoints(): Endpoint[];
    answer(settings: unknown): void;
    hangup(): void;
    decline(): void;
    sendMessage(message: string): void;
    sendAudio(enabled: boolean): void;
  }
  export interface VoxEvent { call: Call; endpoint: Endpoint; videoStream: { id: string }; code: number; text: string; }
  export const Voximplant: {
    getInstance(): {
      connect(): Promise<void>;
      disconnect(): Promise<void>;
      getClientState(): Promise<string>;
      login(user: string, password: string): Promise<void>;
      call(user: string, settings: unknown): Promise<Call>;
      on(event: string, listener: (event: VoxEvent) => void): void;
      off(event: string, listener?: (event: VoxEvent) => void): void;
    };
    ClientEvents: Record<string, string>;
    ClientState: Record<string, string>;
    CallEvents: Record<string, string>;
    EndpointEvents: Record<string, string>;
    Hardware: {
      CameraManager: { getInstance(): { switchCamera(camera: string): void } };
      AudioDeviceManager: { getInstance(): { selectAudioDevice(device: string): void } };
      AudioDevice: Record<string, string>;
    };
    RenderScaleType: { SCALE_FIT: string };
    VideoView: ComponentType<ViewProps & { videoStreamId: string; scaleType: string }>;
  };
}
