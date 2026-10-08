export type NetworkType = 'wifi' | 'hotspot';

export interface SavedNetwork {
  id: string;
  ssid: string;
  password: string;
  type: NetworkType;
  createdAt: number;
}
