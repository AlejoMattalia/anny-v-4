import type {NearbyLensNetwork} from './WifiLensConnectionManager';

export type NearbyNetworkOption = {
  ssid: string;
  signal: number;
  requires24GHz: boolean;
};

// Keep every SSID visible, but only warn when none of its radios can use 2.4 GHz.
export function nearbyNetworkOptions(networks: NearbyLensNetwork[]): NearbyNetworkOption[] {
  const options = new Map<string, NearbyNetworkOption>();
  for (const network of networks) {
    const previous = options.get(network.ssid);
    const requires24GHz = Boolean(network.frequency && network.frequency >= 3000);
    options.set(network.ssid, {
      ssid: network.ssid,
      signal: Math.max(previous?.signal ?? -Infinity, network.signal),
      requires24GHz: (previous?.requires24GHz ?? true) && requires24GHz,
    });
  }
  return [...options.values()].sort((a, b) => b.signal - a.signal);
}
