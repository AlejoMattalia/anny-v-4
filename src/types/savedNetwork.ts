export type NetworkType = 'wifi' | 'hotspot';
export type HotspotSource = 'this-phone' | 'other-phone';

export interface SavedNetwork {
  id: string;
  ssid: string;
  password: string;
  type: NetworkType;
  createdAt: number;
  hotspotSource?: HotspotSource;
}
