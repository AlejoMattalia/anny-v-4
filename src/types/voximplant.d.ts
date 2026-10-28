// The v3-compatible SDK ships Flow, but no TypeScript declarations.
declare module 'react-native-voximplant' {
  import type { ComponentType } from 'react';
  import type { ViewProps } from 'react-native';
  export interface Endpoint {
    on(event: string, listener: (event: VoxEvent) => void): void;
    off(event: string, listener?: (event: VoxEvent) => void): void;
  }
  export interface Call {
    callId: string;
    on(event: string, listener: (event: VoxEvent) => void): void;
    off(event: string, listener?: (event: VoxEvent) => void): void;
    getEndpoints(): Endpoint[];
    answer(settings: unknown): void;
    hangup(): void;
    decline(): void;
    sendMessage(message: string): void;
    sendAudio(enabled: boolean): void;
    sendVideo(enabled: boolean): Promise<void>;
  }
  export interface VoxEvent { call: Call; endpoint: Endpoint; videoStream: { id: string }; code: number; text: string; }
  export const Voximplant: {
    getInstance(): {
      connect(options: { node: string }): Promise<void>;
      disconnect(): Promise<void>;
      getClientState(): Promise<string>;
      login(user: string, password: string): Promise<void>;
      call(user: string, settings: unknown): Promise<Call>;
      on(event: string, listener: (event: VoxEvent) => void): void;
      off(event: string, listener?: (event: VoxEvent) => void): void;
    };
    ClientEvents: Record<string, string>;
    ClientState: Record<string, string>;
    ConnectionNode: Record<string, string>;
    CallEvents: Record<string, string>;
    EndpointEvents: Record<string, string>;
    Hardware: {
      CameraManager: { getInstance(): { switchCamera(camera: string): void } };
      AudioDeviceManager: { getInstance(): {
        getAudioDevices(): Promise<string[]>;
        getActiveDevice(): Promise<string>;
        selectAudioDevice(device: string): void;
        on(event: string, listener: (event: { newDeviceList: string[] }) => void): void;
        off(event: string, listener: (event: { newDeviceList: string[] }) => void): void;
      } };
      AudioDeviceEvents: Record<string, string>;
      AudioDevice: Record<string, string>;
    };
    RenderScaleType: { SCALE_FIT: string };
    VideoView: ComponentType<ViewProps & { videoStreamId: string; scaleType: string }>;
  };
}
